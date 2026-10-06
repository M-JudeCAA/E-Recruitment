const { Prisma } = require('@prisma/client');
const { removeUploads } = require('../utils/uploadFiles');
const prisma = require('../config/db');
const settings = require('./settingsService');

// Erasing a candidate's personal data (FR-ATS-079/080) - by the scheduled
// retention purge (scripts/purgeCandidateData.js) or when a Manager+
// completes an erasure request (dataProtectionController).
//
// The Candidate and Application rows stay, anonymised, so the recruitment
// history (who applied for what, the outcomes, the statistics) still adds
// up; everything that identifies or describes the person goes: their
// profile, documents and uploaded files, answers, referees, the notes and
// notifications about them, and their sign-in. Each purge is logged in
// DataPurgeLog, without personal data.

// An application still in play - its candidate's data is needed. An
// application stays Offered after its offer ends without a hire, so an
// Offered one is finished once its offer is CLOSED_OFFER_STATUSES.
const ACTIVE_STATUSES = ['Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered'];
const CLOSED_OFFER_STATUSES = ['Declined', 'Expired', 'Withdrawn'];

function isActive(application) {
  if (application.status === 'Offered') return !CLOSED_OFFER_STATUSES.includes(application.offer?.status);
  return ACTIVE_STATUSES.includes(application.status);
}

// The same rule as a Prisma filter on Application.
const ACTIVE_APPLICATION_WHERE = {
  OR: [
    { status: { in: ACTIVE_STATUSES.filter((s) => s !== 'Offered') } },
    { status: 'Offered', NOT: { offer: { status: { in: CLOSED_OFFER_STATUSES } } } }
  ]
};
const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

// Every optional field on Candidate is personal data except these, which
// are kept (when they were created, what kind of candidate, the purge).
const KEEP_CANDIDATE = new Set(['id', 'createdAt', 'candidateType', 'purgedAt']);

// Application fields written by the candidate, or about them in free text.
const APPLICATION_TEXT = ['cvUrl', 'coverLetterUrl', 'desiredSalary', 'openToRelocate', 'earliestStartDate', 'whyThisRole',
  'withdrawalReason', 'screeningReasons', 'shortlistScoreReasons', 'essentialCriteriaResults', 'sourceDetail'];
const APPLICATION_JSON = ['desirableResponses', 'disqualifyingResponses', 'referees'];

function anonymisedCandidate(candidateId, now) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Candidate');
  const data = {};
  for (const f of model.fields) {
    if (f.kind !== 'scalar' || f.isRequired || KEEP_CANDIDATE.has(f.name)) continue;
    data[f.name] = f.type === 'Json' ? Prisma.DbNull : null;
  }
  return {
    ...data,
    fullName: `Removed candidate ${candidateId}`,
    email: `removed-${candidateId}@removed.invalid`,
    emailConfirmed: false,
    purgedAt: now
  };
}

/**
 * Erases one candidate's personal data. Refuses (returns { refused }) a
 * candidate with an application still in progress or who was hired, unless
 * `force` - the erasure request path decides that for itself first.
 */
async function purgeCandidate(candidateId, { reason, requestId = null, performedById = null } = {}) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: {
      internalProfile: true,
      applications: {
        include: {
          documents: true, offer: { select: { status: true } },
          interviewRounds: { select: { scoreSheetUrl: true } }
        }
      }
    }
  });
  if (!candidate) return { refused: 'Candidate not found' };
  if (candidate.purgedAt) return { refused: 'This candidate\'s data has already been erased' };
  const blocker = blockerFor(candidate);
  if (blocker) return { refused: blocker };

  const applicationIds = candidate.applications.map((a) => a.id);
  const files = [
    candidate.photoUrl, candidate.internalProfile?.supportingDocumentUrl,
    ...candidate.applications.flatMap((a) => [
      a.cvUrl, a.coverLetterUrl, ...a.documents.map((d) => d.fileUrl),
      // The panel's signed score sheets name the candidate; the score and
      // verdict on the round stay.
      ...a.interviewRounds.map((r) => r.scoreSheetUrl)
    ])
  ].filter(Boolean);
  const now = new Date();
  const removed = {
    profileEntries: 0, documents: candidate.applications.reduce((n, a) => n + a.documents.length, 0),
    files: files.length, applications: applicationIds.length
  };

  await prisma.$transaction(async (tx) => {
    const counts = await Promise.all([
      tx.workExperience.deleteMany({ where: { candidateId } }),
      tx.education.deleteMany({ where: { candidateId } }),
      tx.examGrade.deleteMany({ where: { candidateId } }),
      tx.certificate.deleteMany({ where: { candidateId } })
    ]);
    removed.profileEntries = counts.reduce((n, c) => n + c.count, 0);
    await tx.internalProfile.deleteMany({ where: { candidateId } });
    await tx.verificationToken.deleteMany({ where: { candidateId } });
    await tx.candidateNotification.deleteMany({ where: { candidateId } });
    await tx.candidateTagging.deleteMany({ where: { candidateId } });
    await tx.bulkEmailRecipient.updateMany({ where: { candidateId }, data: { email: `removed-${candidateId}@removed.invalid` } });
    if (applicationIds.length) {
      await tx.applicationDocument.deleteMany({ where: { applicationId: { in: applicationIds } } });
      await tx.application.updateMany({
        where: { id: { in: applicationIds } },
        data: {
          ...Object.fromEntries(APPLICATION_TEXT.map((k) => [k, null])),
          ...Object.fromEntries(APPLICATION_JSON.map((k) => [k, Prisma.DbNull]))
        }
      });
      await tx.interviewRound.updateMany({
        where: { applicationId: { in: applicationIds } },
        data: { resultNotes: null, candidateResponseNote: null, scoreSheetUrl: null, scoreSheetName: null }
      });
      // The education and work history copied into the audit log when they
      // applied (workflowService.captureSnapshot). The row stays, so the
      // trail still shows a snapshot was taken.
      await tx.auditLog.updateMany({
        where: { entityType: 'ApplicationSnapshot', entityId: { in: applicationIds } },
        data: { payload: { erased: true, erasedAt: now.toISOString() } }
      });
      await tx.shortlistRating.updateMany({ where: { assignment: { applicationId: { in: applicationIds } } }, data: { comment: null } });
    }
    await tx.candidate.update({ where: { id: candidateId }, data: anonymisedCandidate(candidateId, now) });
    await tx.dataPurgeLog.create({ data: { candidateId, reason, requestId, performedById, removed, at: now } });
  }, { timeout: 30000, maxWait: 5000 });

  // After the commit: the files themselves. A file that can't be removed
  // is no longer referenced anywhere and goes with the next folder cleanup.
  await removeUploads(files);
  return { purged: true, removed };
}

// Why this candidate's data can't be erased now, or null.
function blockerFor(candidate) {
  if (candidate.applications.some((a) => a.offer?.status === 'Accepted')) {
    return 'This candidate was hired - their records are now employment records and are kept';
  }
  if (candidate.applications.some(isActive)) {
    return 'This candidate has an application still in progress - it must be finished, withdrawn or rejected first';
  }
  return null;
}

// The last time this candidate did anything we know of.
function lastActivity(candidate) {
  const dates = [candidate.createdAt, candidate.lastLoginAt,
    ...candidate.applications.flatMap((a) => [a.createdAt, a.submittedDate, a.rejectedAt, a.offer?.decidedAt])]
    .filter(Boolean).map((d) => new Date(d).getTime());
  return new Date(Math.max(...dates));
}

/** The scheduled purge: everyone past the retention period. */
async function purgeExpired(now = new Date()) {
  const months = await settings.get('candidateRetentionMonths');
  const cutoff = new Date(now.getTime() - months * MONTH_MS);
  const candidates = await prisma.candidate.findMany({
    where: {
      purgedAt: null,
      createdAt: { lt: cutoff },
      OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: cutoff } }],
      applications: { none: { OR: [ACTIVE_APPLICATION_WHERE, { offer: { status: 'Accepted' } }] } }
    },
    include: { applications: { select: { createdAt: true, submittedDate: true, rejectedAt: true, offer: { select: { decidedAt: true } } } } }
  });
  let purged = 0;
  for (const c of candidates.filter((x) => lastActivity(x) < cutoff)) {
    const result = await purgeCandidate(c.id, { reason: 'Retention' });
    if (result.purged) purged += 1;
  }
  return { purged, months };
}

module.exports = { purgeCandidate, purgeExpired, blockerFor, lastActivity, ACTIVE_STATUSES };
