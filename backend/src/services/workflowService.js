const prisma = require('../config/db');
const { sendMail } = require('../utils/mailer');

/**
 * Mandatory internal-candidate verification gate.
 * Blocks Application -> Shortlisted unless HR has verified employment
 * with either comments or a manager recommendation letter on file.
 * Applies regardless of vacancy posting_type or department match.
 */
async function assertCanShortlist(applicationId) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: { include: { internalProfile: true } } }
  });
  if (!application) throw new Error('Application not found');

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
    await client.vacancy.update({ where: { id: vacancyId }, data: { status } });
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
async function acceptOfferTransactionally(offerId) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.offer.updateMany({ where: { id: offerId, status: 'Approved' }, data: { status: 'Accepted' } });
    if (result.count === 0) return { conflict: true };

    const offer = await tx.offer.findUnique({
      where: { id: offerId },
      include: { application: { include: { vacancy: true } } }
    });
    await recomputeVacancyStatus(offer.application.vacancyId, tx);
    return { offer };
  });
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
    const result = await tx.offer.updateMany({ where: { id: offerId, status: 'Approved' }, data: { status: 'Declined' } });
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
  });
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
  recomputeVacancyStatus,
  acceptOfferTransactionally,
  handleOfferDeclined,
  captureSnapshot,
  notifySupervisor,
  logVacancyPostingTypeTransition
};
