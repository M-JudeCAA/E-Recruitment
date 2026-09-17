const prisma = require('../config/db');
const { sendMail } = require('../utils/mailer');

// Mirrors applicationController.NOT_SHORTLISTABLE - kept here too (not
// imported from a controller, which services never depend on) since this
// is the one check both shortlist() and saveRanking() need. Before this,
// only shortlist() enforced it directly; saveRanking() had no status gate
// at all and could silently write a Draft/Offered/Rejected/Withdrawn
// application straight back to ShortlistProposed - most easily triggered
// by a stale ranking UI still holding a since-rejected candidate's id
// (see ApplicationManagement.jsx's alreadyRanked, which is status-agnostic).
const NOT_SHORTLISTABLE = ['Draft', 'Offered', 'Rejected', 'Withdrawn'];

/**
 * Mandatory internal-candidate verification gate, plus a status gate every
 * shortlisting entry point (single shortlist() and bulk saveRanking()) now
 * shares. Blocks Application -> Shortlisted unless HR has verified
 * employment with either comments or a manager recommendation letter on
 * file. Applies regardless of vacancy posting_type or department match.
 */
async function assertCanShortlist(applicationId) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: { include: { internalProfile: true } } }
  });
  if (!application) throw new Error('Application not found');

  if (NOT_SHORTLISTABLE.includes(application.status)) {
    throw new Error(`An application at status "${application.status}" cannot be shortlisted here`);
  }

  if (application.candidate.candidateType === 'Internal') {
    const profile = application.candidate.internalProfile;
    if (!profile || profile.verificationStatus !== 'HR_Verified') {
      throw new Error('Internal candidate employment must be HR Verified before shortlisting');
    }
    if (!profile.verificationEvidenceType) {
      throw new Error('Verification requires comments or a manager recommendation letter');
    }
  }
}

/**
 * Self-approval block: a Principal HR Officer (or above) cannot approve
 * a vacancy or shortlist they personally created/acted on - must route up.
 */
async function assertNotSelfApproval(vacancyId, approverId) {
  const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
  if (vacancy && vacancy.createdById === approverId) {
    throw new Error('Self-approval blocked: route this approval to DHRA / Manager HR instead');
  }
}

/**
 * Self-approval block for the shortlist propose/approve split: whoever
 * ran shortlist()/saveRanking for an application (shortlistProposedById)
 * cannot also be the one who approves that vacancy's proposed shortlist -
 * must route to a different Principal HR Officer or above. Checked against
 * every ShortlistProposed application for the vacancy, not just one, since
 * saveRanking's batch can carry proposals made at different times by
 * different people.
 */
async function assertNotSelfApprovedShortlist(vacancyId, approverId) {
  const proposed = await prisma.application.findMany({
    where: { vacancyId, status: 'ShortlistProposed' }
  });
  if (proposed.some((a) => a.shortlistProposedById === approverId)) {
    throw new Error('Self-approval blocked: you proposed this shortlist - a different Principal HR Officer or above must approve it');
  }
}

/**
 * Computes Vacancy.status from accepted offers vs positions_required.
 * Accepts an optional Prisma client/transaction handle so callers that need
 * this to run atomically alongside an offer-status change (see
 * acceptOfferTransactionally/handleOfferDeclined below) can pass their `tx`
 * - every existing caller that doesn't pass one keeps using the plain
 * top-level `prisma` singleton exactly as before.
 */
async function recomputeVacancyStatus(vacancyId, client = prisma) {
  const vacancy = await client.vacancy.findUnique({ where: { id: vacancyId } });
  if (!vacancy) return;

  const acceptedCount = await client.offer.count({
    where: { status: 'Accepted', application: { vacancyId } }
  });

  let status = 'Open';
  if (acceptedCount >= vacancy.positionsRequired) status = 'Filled';
  else if (acceptedCount > 0) status = 'PartiallyFilled';

  if (vacancy.status !== 'Closed') {
    await client.vacancy.update({
      where: { id: vacancyId },
      data: {
        status,
        // First-fill timestamp for time-to-fill reporting - stamped once,
        // never overwritten or cleared on a later status change (see the
        // schema comment on filledAt).
        ...(status === 'Filled' && !vacancy.filledAt ? { filledAt: new Date() } : {})
      }
    });
  }
}

/**
 * Atomically flips an Approved offer to Accepted and recomputes the
 * vacancy's status in one transaction, rather than as two independent
 * sequential writes. The offer flip itself is guarded (updateMany scoped to
 * status: 'Approved') so a second concurrent accept attempt - a double
 * click, or a race with a decline - can't also succeed; it reports a
 * conflict instead. Running the vacancy-status recompute inside the same
 * transaction as the guarded write also narrows (though, absent a DB-level
 * capacity constraint, doesn't fully eliminate) the window where two
 * different candidates' offers for the same vacancy could both be accepted
 * past positionsRequired.
 */
// Default Prisma interactive-transaction timeout is 5s, and default maxWait
// (time to acquire a transaction slot before even starting) is 2s - both
// too tight for this DB's real-world latency (observed failing with
// "Transaction API error: Transaction not found" under normal load, not
// just when overloaded). Widened here and on handleOfferDeclined below,
// the only two interactive (multi-query, JS-driven) transactions in this
// file - saveRanking's own $transaction (vacancyController.js) is the
// simpler array/batch form, which doesn't hold a transaction open across
// JS-side awaits the way these two do, so it isn't exposed to the same risk.
async function acceptOfferTransactionally(offerId) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.offer.updateMany({
      where: { id: offerId, status: 'Approved' },
      data: { status: 'Accepted', decidedAt: new Date() }
    });
    if (result.count === 0) return { conflict: true };

    const offer = await tx.offer.findUnique({
      where: { id: offerId },
      include: { application: { include: { vacancy: true } } }
    });
    await recomputeVacancyStatus(offer.application.vacancyId, tx);
    return { offer };
  }, { timeout: 15000, maxWait: 5000 });
}

/**
 * Decline cascade: when an offer is declined, promote the next-ranked
 * reserve candidate to Primary and notify the Principal HR Officer that
 * a fresh offer recommendation is needed - without restarting shortlisting.
 * Same atomic-guard-inside-a-transaction shape as acceptOfferTransactionally -
 * the offer flip only applies if it's still Approved, closing the race
 * where a decline lands at the same moment as an approve/accept, or two
 * decline attempts race each other.
 */
async function handleOfferDeclined(offerId) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.offer.updateMany({
      where: { id: offerId, status: 'Approved' },
      data: { status: 'Declined', decidedAt: new Date() }
    });
    if (result.count === 0) return { conflict: true };

    const offer = await tx.offer.findUnique({ where: { id: offerId }, include: { application: true } });
    const vacancyId = offer.application.vacancyId;

    const nextReserve = await tx.application.findFirst({
      where: {
        vacancyId,
        listStatus: 'Reserve',
        status: { notIn: ['Rejected', 'Withdrawn'] }
      },
      orderBy: { rank: 'asc' }
    });

    if (nextReserve) {
      await tx.application.update({
        where: { id: nextReserve.id },
        data: { listStatus: 'Primary' }
      });
      // In a full build: notify the Principal HR Officer that a new
      // offer recommendation is needed for nextReserve.id.
    }

    await recomputeVacancyStatus(vacancyId, tx);
    return { promoted: nextReserve || null };
  }, { timeout: 15000, maxWait: 5000 });
}

/**
 * Qualifications snapshot - freezes WORK_EXPERIENCE + EDUCATION into
 * AUDIT_LOG.payload at submission and at hire, since those tables are
 * candidate-level and reusable (current-state only).
 */
async function captureSnapshot({ entityType, entityId, candidateId, performedById = null }) {
  const [workExperience, education] = await Promise.all([
    prisma.workExperience.findMany({ where: { candidateId } }),
    prisma.education.findMany({ where: { candidateId } })
  ]);

  await prisma.auditLog.create({
    data: {
      entityType,
      entityId,
      action: `${entityType} qualifications snapshot captured`,
      performedById,
      payload: { workExperience, education, capturedAt: new Date().toISOString() }
    }
  });
}

/**
 * Informational supervisor notification on application submission.
 * Never blocks or conditions progression - purely informational.
 */
async function notifySupervisor(applicationId) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      candidate: { include: { internalProfile: true } },
      vacancy: true
    }
  });

  if (application.candidate.candidateType !== 'Internal') return;
  const profile = application.candidate.internalProfile;
  const supervisorEmail = profile?.supervisorEmail;

  if (!supervisorEmail) {
    await prisma.auditLog.create({
      data: {
        entityType: 'SupervisorNotification',
        entityId: applicationId,
        action: 'Supervisor notification skipped - no supervisor email on record'
      }
    });
    return;
  }

  await sendMail({
    to: supervisorEmail,
    subject: 'Notification: staff application submitted',
    html: `<p>${application.candidate.fullName} has applied for ${application.vacancy.title} in ${application.vacancy.department}. This is an informational notice only and requires no action.</p>`
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'SupervisorNotification',
      entityId: applicationId,
      action: 'Supervisor notified of internal application',
      payload: { supervisorEmail }
    }
  });
}

/**
 * Audits an Internal <-> External posting-type transition. Reuses the
 * existing AuditLog table rather than inventing a new dedicated one -
 * the same pattern already used for ApplicationSnapshot/HireSnapshot.
 */
async function logVacancyPostingTypeTransition(vacancyId, fromType, toType, performedById) {
  await prisma.auditLog.create({
    data: {
      entityType: 'Vacancy',
      entityId: vacancyId,
      action: 'PostingTypeTransition',
      performedById,
      payload: { from: fromType, to: toType }
    }
  });
}

module.exports = {
  assertCanShortlist,
  assertNotSelfApproval,
  assertNotSelfApprovedShortlist,
  recomputeVacancyStatus,
  acceptOfferTransactionally,
  handleOfferDeclined,
  captureSnapshot,
  notifySupervisor,
  logVacancyPostingTypeTransition
};
