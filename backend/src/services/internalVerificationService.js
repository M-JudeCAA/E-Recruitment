const prisma = require('../config/db');
const audit = require('./auditService');
const { notifyCandidate } = require('./candidateNotificationService');
const { removeUploads } = require('../utils/uploadFiles');
const { isVerified } = require('../utils/employmentCheck');
const { AppError } = require('../utils/errorResponse');

// HR's check of internal candidates' UCAA employment details
// (InternalProfile): the queue of those waiting (the Employment checks page
// and its Inbox item), and HR's decision on one. An internal candidate
// submits applications only once verified (utils/employmentCheck.js), so this
// is now done before they apply, not from an application.

const DECISIONS = ['HR_Verified', 'Discrepancy_Flagged'];
const AUDIT_FIELDS = ['verificationStatus', 'verificationEvidenceType', 'verificationComments', 'supportingDocumentUrl'];

// Applications still in play - an applicant from before the rule, shown so HR
// knows which checks hold up a shortlist.
const ACTIVE_STATUSES = ['Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed'];

const PROFILE_SELECT = {
  candidateId: true, employeeId: true, department: true, position: true, dateJoined: true,
  verificationStatus: true, verificationEvidenceType: true,
  verificationComments: true, supportingDocumentUrl: true, verifiedDate: true, detailsUpdatedAt: true,
  verifiedBy: { select: { name: true } },
  candidate: {
    select: {
      id: true, fullName: true, email: true, phone: true, createdAt: true, entraObjectId: true,
      applications: {
        where: { status: { in: ACTIVE_STATUSES } },
        select: { id: true, status: true, vacancy: { select: { id: true, jobRef: true, title: true } } }
      }
    }
  }
};

// The staff account(s) the viewer acts as - nobody checks their own employment.
async function ownCandidateIds(req) {
  const staffIds = [req.user.id, req.actingAsDelegateFor].filter(Boolean);
  const staff = await prisma.staffUser.findMany({ where: { id: { in: staffIds } }, select: { email: true, entraObjectId: true } });
  const or = (staff || []).flatMap((s) => [{ email: s.email }, ...(s.entraObjectId ? [{ entraObjectId: s.entraObjectId }] : [])]);
  if (!or.length) return [];
  const candidates = await prisma.candidate.findMany({ where: { OR: or }, select: { id: true } });
  return (candidates || []).map((c) => c.id);
}

function view(profile) {
  const c = profile.candidate;
  return {
    candidateId: c.id, name: c.fullName, email: c.email, phone: c.phone,
    employeeId: profile.employeeId, department: profile.department, position: profile.position,
    dateJoined: profile.dateJoined,
    status: isVerified(profile) ? 'HR_Verified' : profile.verificationStatus === 'HR_Verified' ? 'Pending' : profile.verificationStatus,
    evidenceType: profile.verificationEvidenceType, comments: profile.verificationComments,
    supportingDocumentUrl: profile.supportingDocumentUrl,
    checkedBy: profile.verifiedBy?.name || null, checkedAt: profile.verifiedDate,
    waitingSince: profile.detailsUpdatedAt || c.createdAt,
    applications: c.applications.map((a) => ({ id: a.id, status: a.status, vacancyId: a.vacancy.id, jobRef: a.vacancy.jobRef, title: a.vacancy.title }))
  };
}

/**
 * Internal candidates whose employment details wait for HR's check (Pending,
 * or flagged and not yet resolved), oldest first - only those who have given
 * their details (a department picked). `include: 'all'` lists checked ones too.
 * Leaves out the viewer's own profile and erased candidates.
 */
async function queue(req, { include = 'waiting' } = {}) {
  const own = await ownCandidateIds(req);
  const rows = await prisma.internalProfile.findMany({
    where: {
      departmentId: { not: null },
      candidate: { candidateType: 'Internal', purgedAt: null, ...(own.length ? { id: { notIn: own } } : {}) },
      ...(include === 'all' ? {} : { NOT: { verificationStatus: 'HR_Verified', verificationEvidenceType: { not: null } } })
    },
    select: PROFILE_SELECT
  }) || [];
  const people = rows.map(view);
  await addPreviousChecks(people);
  return people.sort((a, b) => new Date(a.waitingSince) - new Date(b.waitingSince));
}

const DECIDED = { 'Employment verified': 'HR_Verified', 'Employment discrepancy flagged': 'Discrepancy_Flagged' };
const DETAILS_CHANGED = 'Employment details changed - back to HR for checking';

/**
 * A check waiting again after the candidate changed checked details has
 * lost who decided it and when (candidateController.updateInternalProfile
 * clears them), so HR's second look would start blind. From the audit
 * trail: `previousCheck` - the last decision (by, at, comments) and what the
 * candidate changed since ({ field: { from, to } }).
 */
async function addPreviousChecks(people) {
  const waiting = people.filter((p) => p.status === 'Pending');
  if (!waiting.length) return;
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'InternalProfile', entityId: { in: waiting.map((p) => p.candidateId) }, action: { in: [...Object.keys(DECIDED), DETAILS_CHANGED] } },
    select: { entityId: true, action: true, timestamp: true, payload: true, performedBy: { select: { name: true } } },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }]
  }) || [];
  for (const person of waiting) {
    let previous = null;
    for (const row of rows.filter((r) => r.entityId === person.candidateId)) {
      if (DECIDED[row.action]) {
        previous = { decision: DECIDED[row.action], by: row.performedBy?.name || null, at: row.timestamp, comments: row.payload?.comment || null, changes: {} };
      } else if (previous) {
        for (const [field, change] of Object.entries(row.payload?.changes || {})) {
          if (field === 'verificationStatus') continue;
          previous.changes[field] = { from: previous.changes[field]?.from ?? change.from, to: change.to };
        }
      }
    }
    if (previous) person.previousCheck = previous;
  }
}

/** How many wait, and since when the oldest - for the Inbox. */
async function waitingSummary(req) {
  const waiting = (await queue(req)).filter((p) => p.status !== 'Discrepancy_Flagged');
  return { count: waiting.length, oldest: waiting[0]?.waitingSince || null, withApplications: waiting.filter((p) => p.applications.length).length };
}

/**
 * HR's decision on one candidate's employment details: HR_Verified or
 * Discrepancy_Flagged, with comments (any length) or the candidate's
 * appointment letter as evidence. Audited before/after; the candidate is
 * told; a replaced letter is removed. Never the viewer's own.
 */
async function decide(req, candidateId, { decision, comments, documentUrl }) {
  if (!DECISIONS.includes(decision)) throw new AppError(`decision must be one of: ${DECISIONS.join(', ')}`, 400);
  const text = typeof comments === 'string' ? comments.trim() : '';
  if (!text && !documentUrl) {
    throw new AppError('Give comments or attach their appointment letter', 422);
  }
  const before = await prisma.internalProfile.findUnique({ where: { candidateId } });
  if (!before) throw new AppError('No internal profile found for this candidate', 404);
  if ((await ownCandidateIds(req)).includes(candidateId)) {
    throw Object.assign(new AppError('You cannot check your own employment details. Another member of HR must do it.', 403), { code: 'SELF_VERIFICATION' });
  }
  // A flagged discrepancy is the candidate's to sort out: only their
  // corrected details (back to Pending) reopen the check for HR.
  if (before.verificationStatus === 'Discrepancy_Flagged') {
    throw Object.assign(new AppError(decision === 'HR_Verified'
      ? 'A discrepancy is flagged on these details. They can be verified once the candidate has corrected them.'
      : 'A discrepancy is already flagged on these details. The candidate has been asked to correct them.', 409), { code: 'DISCREPANCY_NOT_RESOLVED' });
  }

  // Only from the status just read, so two of HR deciding at once can't both
  // get through (the second gets 409).
  const after = await prisma.internalProfile.update({
    where: { candidateId, verificationStatus: before.verificationStatus },
    data: {
      verificationStatus: decision,
      verificationEvidenceType: documentUrl ? 'ManagerRecommendationLetter' : 'Comments',
      verificationComments: text || null,
      supportingDocumentUrl: documentUrl || null,
      verifiedById: req.user.id,
      verifiedDate: new Date()
    }
  }).catch((err) => {
    if (err?.code === 'P2025') {
      throw Object.assign(new AppError('Someone else has just decided this check. Reload to see where it stands.', 409), { code: 'CHECK_CHANGED' });
    }
    throw err;
  });
  if (before.supportingDocumentUrl && before.supportingDocumentUrl !== after.supportingDocumentUrl) {
    await removeUploads(before.supportingDocumentUrl);
  }

  await audit.record({
    entityType: 'InternalProfile', entityId: candidateId, actor: audit.actorFrom(req),
    action: decision === 'HR_Verified' ? 'Employment verified' : 'Employment discrepancy flagged',
    before, after, fields: AUDIT_FIELDS, comment: text || undefined
  });

  // The decision is saved; a failed notice must not undo it.
  try {
    if (decision === 'HR_Verified') {
      await notifyCandidate(candidateId, 'EmploymentVerified',
        'HR has verified your UCAA employment details. You can now submit applications for internal vacancies.');
    } else {
      await notifyCandidate(candidateId, 'EmploymentDiscrepancy',
        'HR found a problem with your UCAA employment details. Please check them on your profile - changing them sends them back to HR - or contact HR. You can submit applications once they are verified.');
    }
  } catch (err) {
    console.error(`Employment check notice to candidate ${candidateId} failed:`, err.message);
  }
  return after;
}

// Applicants from before the rule who are still unverified, on one vacancy -
// the committee step warns about them, since they can't be shortlisted.
async function unverifiedApplicants(vacancyId, statuses = ['UnderReview']) {
  const rows = await prisma.application.findMany({
    where: { vacancyId, status: { in: statuses }, candidate: { candidateType: 'Internal' } },
    select: { id: true, status: true, candidate: { select: { id: true, fullName: true, internalProfile: { select: { verificationStatus: true, verificationEvidenceType: true } } } } }
  }) || [];
  return rows.filter((a) => !isVerified(a.candidate.internalProfile))
    .map((a) => ({ applicationId: a.id, candidateId: a.candidate.id, name: a.candidate.fullName, status: a.candidate.internalProfile?.verificationStatus || 'Pending' }));
}

module.exports = { queue, waitingSummary, decide, unverifiedApplicants, ownCandidateIds, DECISIONS };
