const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');
const { CLEARED_MERIT } = require('./meritListService');
const { OPEN_STATUSES } = require('./offerService');
const { cancelUpcomingInterviews } = require('./applicationWithdrawalService');
const { notifyCandidate } = require('./candidateNotificationService');
const slaModel = require('../models/slaModel');
const audit = require('./auditService');

// Closing a vacancy that still has people in it. Closing itself only takes
// the advert down (vacancyController.close) - which is right when selection
// carries on from the applicants already in, and wrong when UCAA has stopped
// recruiting for the post: applicants were left "under review" for good,
// booked interviews stood, and open offers could still be approved and
// accepted. So when a vacancy has work in progress, whoever closes it says
// which it is:
//   continue - the advert comes down, selection goes on as it was;
//   end      - the recruitment stops here (endRecruitment below).
//
// Ending it: every offer not yet answered is withdrawn (nobody is promoted
// from the reserve list - there is no post to give), every application still
// in play is closed as Rejected with the reason below, interviews still
// booked are cancelled with their calendar entries, and each candidate is
// told the recruitment was discontinued - a different message from "you
// were unsuccessful". An offer a candidate has ACCEPTED is never ended this
// way: that person is owed a decision of their own (mark them hired, or a
// Manager withdraws the offer), so ending is refused until it is made.
// Re-opening the vacancy later doesn't bring anyone back by itself; a
// Principal HR Officer reinstates the applications that should continue.

const ACTIVE_STATUSES = ['Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed'];
const DISCONTINUED_REASON = 'UCAA is no longer recruiting for this vacancy.';

function coded(message, status, code, extra = {}) {
  return Object.assign(new AppError(message, status), { code, ...extra });
}

/** What is still in play on a vacancy - what closing it would leave behind. */
async function inProgress(vacancyId) {
  const [applications, scheduledInterviews, openOffers, acceptedNotHired] = await Promise.all([
    prisma.application.count({ where: { vacancyId, status: { in: ACTIVE_STATUSES } } }),
    prisma.interviewRound.count({ where: { status: 'Scheduled', application: { vacancyId } } }),
    prisma.offer.count({ where: { status: { in: OPEN_STATUSES }, application: { vacancyId } } }),
    prisma.offer.count({ where: { status: 'Accepted', hire: { is: null }, application: { vacancyId } } })
  ]);
  const counts = {
    applications: applications || 0, scheduledInterviews: scheduledInterviews || 0,
    openOffers: openOffers || 0, acceptedNotHired: acceptedNotHired || 0
  };
  return { ...counts, any: counts.applications + counts.openOffers + counts.acceptedNotHired > 0 };
}

/**
 * Closes the vacancy and ends its recruitment, in one transaction, only if
 * the vacancy is still at fromStatus. Returns { conflict: true } when it is
 * not, else { applications, offers } - what was closed, for the notices.
 */
async function endRecruitment(vacancy, fromStatus, reason, staffId, now = new Date()) {
  const vacancyId = vacancy.id;
  const result = await prisma.$transaction(async (tx) => {
    // The vacancy row first, as wherever offers are counted
    // (workflowService.acceptOfferTransactionally): an acceptance landing
    // at the same moment runs before or after this, never through it.
    await tx.$queryRaw`SELECT id FROM Vacancy WHERE id = ${vacancyId} FOR UPDATE`;
    const closed = await tx.vacancy.updateMany({
      where: { id: vacancyId, status: fromStatus }, data: { status: 'Closed', closedAt: now, closeReason: reason }
    });
    if (closed.count === 0) return { conflict: true };

    const accepted = await tx.offer.count({ where: { status: 'Accepted', hire: { is: null }, application: { vacancyId } } });
    if (accepted > 0) {
      throw coded('A candidate has accepted an offer on this vacancy - mark them hired, or have a Manager withdraw the offer, before ending the recruitment',
        409, 'ACCEPTED_OFFERS_OUTSTANDING');
    }

    const offers = await tx.offer.findMany({
      where: { status: { in: OPEN_STATUSES }, application: { vacancyId } },
      select: { id: true, status: true, applicationId: true, application: { select: { candidateId: true } } }
    });
    if (offers.length) {
      await tx.offer.updateMany({
        where: { id: { in: offers.map((o) => o.id) }, status: { in: OPEN_STATUSES } },
        data: { status: 'Withdrawn', decidedAt: now, withdrawnById: staffId, withdrawalReason: `The recruitment was ended: ${reason}`.slice(0, 1000) }
      });
    }

    const applications = await tx.application.findMany({
      where: { vacancyId, status: { in: ACTIVE_STATUSES } }, select: { id: true, status: true, candidateId: true }
    });
    // One write per status, so each row keeps where it stood - what a later
    // reinstatement goes back to.
    for (const status of ACTIVE_STATUSES) {
      const ids = applications.filter((a) => a.status === status).map((a) => a.id);
      if (!ids.length) continue;
      await tx.application.updateMany({
        where: { id: { in: ids }, status },
        data: {
          status: 'Rejected', rejectedAt: now, rejectedById: staffId, rejectionReason: DISCONTINUED_REASON, statusBeforeRejection: status,
          rank: null, listStatus: null, ...CLEARED_MERIT, rankVersion: { increment: 1 }
        }
      });
    }
    return { applications, offers };
  }, { timeout: 30000, maxWait: 5000 });
  return result;
}

/**
 * After endRecruitment committed: the interviews, the audit trail and the
 * candidates. Best-effort throughout - nothing here undoes the closure.
 */
async function afterEnded(vacancy, { applications, offers }, reason, actor) {
  const safely = async (what, fn) => {
    try { await fn(); } catch (err) { console.error(`Ending recruitment on vacancy ${vacancy.id}: ${what} failed:`, err); }
  };
  for (const a of applications.filter((x) => x.status === 'InterviewScheduled')) {
    await safely(`cancelling the interviews of application ${a.id}`,
      () => cancelUpcomingInterviews(a.id, new Date(), 'UCAA is no longer recruiting for this vacancy'));
  }
  for (const o of offers) await safely(`closing the approval deadline of offer ${o.id}`, () => slaModel.resolveEscalations('OfferApproval', o.id));
  await audit.recordMany([
    ...offers.map((o) => ({
      entityType: 'Offer', entityId: o.id, action: 'Offer withdrawn (recruitment ended)', actor,
      before: { status: o.status }, after: { status: 'Withdrawn' }, fields: ['status'], comment: reason
    })),
    ...applications.map((a) => ({
      entityType: 'Application', entityId: a.id, action: 'Application closed (recruitment ended)', actor,
      before: { status: a.status }, after: { status: 'Rejected' }, fields: ['status'], comment: reason
    }))
  ]);

  // One message each. Someone holding an issued offer is told that first.
  const offered = new Set(offers.filter((o) => o.status === 'Approved').map((o) => o.application.candidateId));
  for (const candidateId of offered) {
    await safely(`the notice to candidate ${candidateId}`, () => notifyCandidate(candidateId, 'OfferWithdrawn',
      `Your offer for "${vacancy.title}" has been withdrawn because UCAA is no longer recruiting for this vacancy. Please contact HR if you have any questions.`));
  }
  for (const a of applications) {
    await safely(`the notice to candidate ${a.candidateId}`, () => notifyCandidate(a.candidateId, 'RecruitmentDiscontinued',
      `UCAA is no longer recruiting for "${vacancy.title}" (${vacancy.jobRef}), so your application will not be taken further. `
      + 'This is not a decision about your application. Thank you for your interest in UCAA - you are welcome to apply for other vacancies.'));
  }
}

module.exports = { inProgress, endRecruitment, afterEnded, ACTIVE_STATUSES, DISCONTINUED_REASON };
