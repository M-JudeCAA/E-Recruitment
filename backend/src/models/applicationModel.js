const prisma = require('../config/db');

// Shared with findByVacancy and findManyForHr below - whitelisting only what
// an applicant list actually reads rather than the full Candidate row, which
// would otherwise hand every HR officer viewing this list each applicant's
// passwordHash. education/workExperience/examGrades/certificates ARE
// whitelisted since this is also the data source useGeneratedCvDownload.jsx
// reads to build the on-demand CV HR generates for an applicant - see
// GeneratedCvPrintLayout.jsx.
const CANDIDATE_SELECT = {
  id: true, fullName: true, email: true, phone: true, candidateType: true,
  location: true, linkedinUrl: true, portfolioUrl: true, workAuthorization: true,
  nationalId: true, idType: true, dateOfBirth: true, flyingHours: true,
  education: true, workExperience: true, examGrades: true, certificates: true,
  internalProfile: true
};

// Cross-vacancy include (findManyForHr) - same candidate/interviewRounds/
// offer/rejectedBy shape as findByVacancy, plus a vacancy select since this
// spans vacancies instead of being scoped to one already-known vacancy.
const HR_LIST_INCLUDE = {
  candidate: { select: CANDIDATE_SELECT },
  vacancy: {
    select: {
      id: true, jobRef: true, title: true, positionsRequired: true, preferredFieldOfStudy: true,
      department: { select: { name: true, directorate: { select: { name: true } } } }
    }
  },
  interviewRounds: true,
  offer: true,
  rejectedBy: { select: { name: true } }
};

// candidateType/search both narrow on the related Candidate row, so they
// share one sub-object built here rather than each independently trying to
// set where.candidate.
function buildHrWhere({ vacancyId, status, departmentId, candidateType, screeningPassed, search }) {
  const where = { status: status || { not: 'Draft' } };
  if (vacancyId) where.vacancyId = vacancyId;
  if (departmentId) where.vacancy = { departmentId };
  const candidateWhere = {};
  if (candidateType) candidateWhere.candidateType = candidateType;
  if (search) {
    // No mode: 'insensitive' - this is MySQL, not Postgres, and Prisma
    // doesn't support that mode there. MySQL's default collation is
    // already case-insensitive, so plain `contains` is fine.
    candidateWhere.OR = [{ fullName: { contains: search } }, { email: { contains: search } }];
  }
  if (Object.keys(candidateWhere).length > 0) where.candidate = candidateWhere;
  if (screeningPassed != null) where.screeningPassed = screeningPassed;
  return where;
}

module.exports = {
  create: (data) => prisma.application.create({ data }),
  findById: (id, include) => prisma.application.findUnique({ where: { id }, include }),
  findFirst: (where) => prisma.application.findFirst({ where }),
  // Excludes Draft - a draft is not yet an application HR has any
  // business seeing; it only becomes visible to HR once the candidate
  // actually submits it. Only reachable as a real, populated status once
  // the draft/submit split exists (previously every row was created
  // straight at Submitted, so this filter had nothing to do).
  findByVacancy: (vacancyId) => prisma.application.findMany({
    where: { vacancyId, status: { not: 'Draft' } },
    include: {
      candidate: { select: CANDIDATE_SELECT },
      interviewRounds: true,
      offer: true,
      rejectedBy: { select: { name: true } }
    },
    orderBy: [{ rank: 'asc' }, { shortlistScore: 'desc' }]
  }),
  // Cross-vacancy "Application Management" queue - see applicationController.list.
  // filters is buildHrWhere's param shape; skip/take drive pagination.
  findManyForHr: ({ skip, take, ...filters }) => prisma.application.findMany({
    where: buildHrWhere(filters),
    include: HR_LIST_INCLUDE,
    orderBy: { submittedDate: 'desc' },
    skip, take
  }),
  countForHr: (filters) => prisma.application.count({ where: buildHrWhere(filters) }),
  findByCandidate: (candidateId) => prisma.application.findMany({
    where: { candidateId },
    include: { vacancy: true, interviewRounds: true, offer: true },
    orderBy: { createdAt: 'desc' }
  }),
  // url is always a single scalar path (see fileController.js's one caller,
  // built from one filename) - named singular here (it previously read
  // "urls", misleadingly suggesting array support the OR clause below
  // doesn't actually provide).
  findOwnedByCandidate: (candidateId, url) => prisma.application.findFirst({
    where: { candidateId, OR: [{ cvUrl: url }, { coverLetterUrl: url }] }
  }),
  findByVacancyAndStatus: (vacancyId, status) => prisma.application.findMany({
    where: { vacancyId, status }
  }),
  // Same Draft exclusion as findByVacancy - a single query in place of the
  // per-vacancy fetch-and-sum HRHome.jsx used to do.
  countAll: () => prisma.application.count({ where: { status: { not: 'Draft' } } }),
  // Same Draft exclusion, scoped to one vacancy.
  countByVacancy: (vacancyId) => prisma.application.count({ where: { vacancyId, status: { not: 'Draft' } } }),
  // include is optional (undefined -> Prisma returns scalars only, same
  // as before) - added so a couple of callers that need the vacancy title
  // for a candidate-facing notification message don't need a second
  // round-trip query just for that.
  update: (id, data, include) => prisma.application.update({ where: { id }, data, include }),
  // Atomic guard against a submit race - two near-simultaneous submit
  // requests for the same Draft (double API call, a retry, two open tabs)
  // both pass a "status === Draft" read before either commits a write.
  // Scoping the update itself to status: expectedStatus (updateMany, so it
  // reports a count instead of throwing when zero rows match) means only
  // the first one to actually reach the database wins - the second sees
  // count 0 and knows someone else already changed it, instead of both
  // proceeding to capture a snapshot and notify the supervisor twice.
  updateIfStatus: (id, expectedStatus, data) => prisma.application.updateMany({ where: { id, status: expectedStatus }, data }),
  // Used only for cancelling a Draft (never a Submitted-or-later
  // application) - see applicationDraftController.withdraw. Deleting the
  // row, rather than marking it Withdrawn, frees the (vacancyId,
  // candidateId) uniqueness slot so the candidate can start again.
  remove: (id) => prisma.application.delete({ where: { id } })
};
