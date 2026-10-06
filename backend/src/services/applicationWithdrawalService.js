const prisma = require('../config/db');
const workflow = require('./workflowService');
const interviewModel = require('../models/interviewModel');
const invitations = require('./interviewInvitationService');
const { notifyCandidate } = require('./candidateNotificationService');
const { CLEARED_MERIT } = require('./meritListService');
const { AppError } = require('../utils/errorResponse');

// A candidate withdrawing a submitted application, at any stage before an
// offer (applicationDraftController.withdraw). Once an offer has been made
// they decline it instead (offerController.decline); a Draft is simply
// deleted. Withdrawal is a one-way door: re-applying to the vacancy is
// refused (saveDraft).
//
// What follows from it:
//   - the application is Withdrawn, off any interview shortlist ranking and
//     off the merit list (rank cleared, rankVersion bumped so a board loaded
//     before can't write over it);
//   - interviews still to happen are cancelled - the candidate's and the
//     panelists' calendar entries with them;
//   - a Primary on the approved merit list frees their post for the next
//     reserve (workflowService.releasePrimary), as a declined offer does.

const WITHDRAWABLE_STATUSES = ['Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed'];
const CANCELLATION_REASON = 'The candidate withdrew their application';

async function withdraw(application, reason) {
  if (application.status === 'Offered') {
    throw new AppError('You have been made an offer for this vacancy - decline the offer instead', 422);
  }
  if (!WITHDRAWABLE_STATUSES.includes(application.status)) {
    throw new AppError('This application can no longer be withdrawn', 422);
  }
  const wasPrimary = application.meritStatus === 'Approved' && application.meritListStatus === 'Primary';
  const now = new Date();

  // Only from the status read: an HR decision landing meanwhile stands.
  const moved = await prisma.application.updateMany({
    where: { id: application.id, status: application.status },
    data: {
      status: 'Withdrawn', withdrawalReason: reason || null,
      rank: null, listStatus: null, ...CLEARED_MERIT, rankVersion: { increment: 1 }
    }
  });
  if (moved.count === 0) throw new AppError('This application was just updated - refresh and try again', 409);

  const cancelled = await cancelUpcomingInterviews(application.id, now);
  const promoted = wasPrimary ? await workflow.releasePrimary(application.vacancyId) : null;
  return { cancelledInterviewIds: cancelled.map((r) => r.id), promoted, wasPrimary };
}

// Every round still Scheduled is called off. Notices are best-effort: the
// withdrawal has already happened.
async function cancelUpcomingInterviews(applicationId, now) {
  const scheduled = await prisma.interviewRound.findMany({ where: { applicationId, status: 'Scheduled' }, select: { id: true } });
  const cancelled = [];
  for (const { id } of scheduled) {
    const result = await prisma.interviewRound.updateMany({
      where: { id, status: 'Scheduled' },
      data: { status: 'Cancelled', cancelledAt: now, cancellationReason: CANCELLATION_REASON }
    });
    if (result.count === 0) continue;
    const round = await interviewModel.findDetailed(id);
    if (round) cancelled.push(round);
  }
  for (const round of cancelled) {
    try {
      await notifyCandidate(round.application.candidateId, 'InterviewCancelled',
        invitations.candidateMessage('cancelled', round, round.application.vacancy.title, { reason: CANCELLATION_REASON }),
        { calendar: invitations.candidateInvitation(round, round.application.vacancy.title, { cancelled: true }) });
    } catch (err) {
      console.error(`Interview cancellation notice for round ${round.id} failed:`, err);
    }
  }
  if (cancelled.length) {
    try {
      await invitations.syncPanelInvitations(cancelled, 'cancelled', { reason: CANCELLATION_REASON });
    } catch (err) {
      console.error('Panel calendar update after a withdrawal failed:', err);
    }
  }
  return cancelled;
}

module.exports = { withdraw, WITHDRAWABLE_STATUSES };
