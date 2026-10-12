const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');

// Undoing a rejection made by mistake - the wrong applicant picked on the
// board, a "Reject" verdict entered against the wrong score sheet. Without
// it a mistaken rejection was permanent: the candidate can't apply again
// (one application per vacancy), and nothing else moves an application out
// of Rejected.
//
// The application goes back to where it stood, but never past a step that
// needs someone's decision again:
//   - Submitted stays Submitted; UnderReview and ShortlistProposed go to
//     UnderReview (a proposal is made, and approved, afresh);
//   - Shortlisted and InterviewScheduled go to Shortlisted - interviews
//     still booked were cancelled by the rejection, so a new one is booked;
//   - with interview results on record it is Interviewed. A "Reject"
//     verdict stays on the round until HR corrects it
//     (interviewController.recordResults allows that once reinstated), and
//     only then can the candidate be put on the merit list.
// Rank and merit-list place were cleared by the rejection and stay cleared;
// someone EXCO struck off still has no EXCO approval and needs one.

const MIN_REASON = 10;

function coded(message, status, code) {
  const err = new AppError(message, status);
  err.code = code;
  return err;
}

// Rows rejected before statusBeforeRejection existed: the audit trail's
// last "-> Rejected" change says where they were.
async function statusFromAuditTrail(applicationId) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'Application', entityId: applicationId },
    orderBy: { id: 'desc' }, take: 50, select: { payload: true }
  });
  const rejection = (rows || []).find((r) => r.payload?.changes?.status?.to === 'Rejected');
  return rejection?.payload?.changes?.status?.from || null;
}

const BACK_TO = {
  Submitted: 'Submitted',
  UnderReview: 'UnderReview',
  ShortlistProposed: 'UnderReview',
  Shortlisted: 'Shortlisted',
  InterviewScheduled: 'Shortlisted',
  Interviewed: 'Shortlisted'
};

async function targetStatus(application) {
  const held = await prisma.interviewRound.count({ where: { applicationId: application.id, status: 'Completed' } });
  if (held > 0) return 'Interviewed';
  const before = application.statusBeforeRejection || await statusFromAuditTrail(application.id);
  return BACK_TO[before] || 'Submitted';
}

/**
 * Puts a Rejected application back in consideration. Returns { status,
 * reason, application } - the status it now has, and the row as it was.
 */
async function reinstate(applicationId, reasonInput) {
  const reason = typeof reasonInput === 'string' ? reasonInput.trim().slice(0, 1000) : '';
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      vacancy: { select: { id: true, title: true, jobRef: true, status: true } },
      candidate: { select: { id: true, purgedAt: true } }
    }
  });
  if (!application) throw new AppError('Application not found', 404);
  if (application.status !== 'Rejected') {
    throw new AppError(`Only a rejected application can be reinstated - this one is at "${application.status}"`, 422);
  }
  if (reason.length < MIN_REASON) {
    throw new AppError(`Say why the rejection is being undone (${MIN_REASON} characters or more) - it is kept in the history`, 400);
  }
  if (application.candidate?.purgedAt) {
    throw coded('This candidate\'s data has been erased, so the application can\'t be reinstated', 409, 'CANDIDATE_ERASED');
  }
  if (['Closed', 'Rejected'].includes(application.vacancy.status)) {
    throw coded(`This vacancy is ${application.vacancy.status.toLowerCase()} - re-open it before reinstating an application on it`, 409, 'VACANCY_NOT_OPEN');
  }

  const status = await targetStatus(application);
  // Back among the applicants still to be shortlisted - but a committee that
  // has already been given its applicants won't assess this one.
  if (['Submitted', 'UnderReview'].includes(status)) {
    const exercise = await prisma.shortlistExercise.findUnique({ where: { vacancyId: application.vacancyId }, select: { status: true } });
    if (exercise && exercise.status !== 'Setup') {
      const assigned = await prisma.shortlistAssignment.count({ where: { applicationId } });
      if (!assigned) {
        throw coded('The shortlisting committee has already been given its applicants, and this one was not among them - they can no longer be assessed for this vacancy',
          409, 'COMMITTEE_ASSESSING');
      }
    }
  }

  // Only from Rejected: two people reinstating at once can't both act.
  const moved = await prisma.application.updateMany({
    where: { id: applicationId, status: 'Rejected' },
    data: {
      status, rejectedAt: null, rejectedById: null, rejectionReason: null, statusBeforeRejection: null,
      ...(status === 'UnderReview' ? { shortlistProposedAt: null, shortlistProposedById: null } : {}),
      rankVersion: { increment: 1 }
    }
  });
  if (moved.count === 0) throw new AppError('This application was already updated - please refresh and try again', 409);
  return { status, reason, application };
}

module.exports = { reinstate, targetStatus, MIN_REASON };
