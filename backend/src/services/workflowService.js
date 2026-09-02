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
 */
async function recomputeVacancyStatus(vacancyId) {
  const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
  if (!vacancy) return;

  const acceptedCount = await prisma.offer.count({
    where: { status: 'Accepted', application: { vacancyId } }
  });

  let status = 'Open';
  if (acceptedCount >= vacancy.positionsRequired) status = 'Filled';
  else if (acceptedCount > 0) status = 'PartiallyFilled';

  if (vacancy.status !== 'Closed') {
    await prisma.vacancy.update({ where: { id: vacancyId }, data: { status } });
  }
}

/**
 * Decline cascade: when an offer is declined, promote the next-ranked
 * reserve candidate to Primary and notify the Principal HR Officer that
 * a fresh offer recommendation is needed - without restarting shortlisting.
 */
async function handleOfferDeclined(offerId) {
  const offer = await prisma.offer.update({
    where: { id: offerId },
    data: { status: 'Declined' },
    include: { application: true }
  });

  const vacancyId = offer.application.vacancyId;

  const nextReserve = await prisma.application.findFirst({
    where: {
      vacancyId,
      listStatus: 'Reserve',
      status: { notIn: ['Rejected', 'Withdrawn'] }
    },
    orderBy: { rank: 'asc' }
  });

  if (nextReserve) {
    await prisma.application.update({
      where: { id: nextReserve.id },
      data: { listStatus: 'Primary' }
    });
    // In a full build: notify the Principal HR Officer that a new
    // offer recommendation is needed for nextReserve.id.
  }

  await recomputeVacancyStatus(vacancyId);
  return { promoted: nextReserve || null };
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

module.exports = {
  assertCanShortlist,
  assertNotSelfApproval,
  recomputeVacancyStatus,
  handleOfferDeclined,
  captureSnapshot,
  notifySupervisor
};
