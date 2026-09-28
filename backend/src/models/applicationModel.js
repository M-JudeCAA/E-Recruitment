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

// Interview rounds as HR lists show them - with the panel, so a review card
// can show panel progress without fetching each round separately.
const HR_ROUNDS_INCLUDE = { include: { panelMembers: true }, orderBy: { roundNumber: 'asc' } };

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
  interviewRounds: HR_ROUNDS_INCLUDE,
  offer: true,
  rejectedBy: { select: { name: true } }
};

// candidateType/search both narrow on the related Candidate row, so they
// share one sub-object built here rather than each independently trying to
// set where.candidate.
//
// needsActionOr (see applicationController.list) supersedes the plain
// status/screeningPassed filters when present - it's still AND-ed with
// vacancyId/department/candidateType/search, and status: {not: 'Draft'}
// stays in place underneath it as defense-in-depth (every needsActionOr
// branch is already non-Draft by construction, so this never excludes
// anything real).
function buildHrWhere({ vacancyId, status, departmentId, candidateType, screeningPassed, search, needsActionOr }) {
  const where = { status: status || { not: 'Draft' } };
  if (needsActionOr) where.OR = needsActionOr;
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
  if (screeningPassed != null && !needsActionOr) where.screeningPassed = screeningPassed;
  return where;
}

// sort query param -> Prisma orderBy, for the cross-vacancy queue.
// 'score' and 'deadline' put nulls last under MySQL's default collation
// (NULL sorts lowest, so ASC puts them first and DESC puts them last) -
// exactly what's wanted here: unscored applications / vacancies without a
// deadline fall to the end rather than dominating the top of the list.
const HR_SORT_ORDER_BY = {
  newest: { submittedDate: 'desc' },
  oldest: { submittedDate: 'asc' },
  score: { shortlistScore: 'desc' },
  deadline: { vacancy: { deadline: 'asc' } }
};

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
      interviewRounds: HR_ROUNDS_INCLUDE,
      offer: true,
      rejectedBy: { select: { name: true } }
    },
    orderBy: [{ rank: 'asc' }, { shortlistScore: 'desc' }]
  }),
  // Cross-vacancy "Application Management" queue - see applicationController.list.
  // filters is buildHrWhere's param shape; skip/take drive pagination; sort
  // is one of HR_SORT_ORDER_BY's keys (undefined/unrecognized -> newest first).
  findManyForHr: ({ skip, take, sort, ...filters }) => prisma.application.findMany({
    where: buildHrWhere(filters),
    include: HR_LIST_INCLUDE,
    orderBy: HR_SORT_ORDER_BY[sort] || HR_SORT_ORDER_BY.newest,
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
  // Bulk-promotes every ShortlistProposed application for a vacancy to
  // Shortlisted in one statement - see applicationController.approveShortlist.
  // Scoped to status: 'ShortlistProposed' so it only ever touches rows the
  // caller already fetched/self-approval-checked, not anything that moved
  // on in between (e.g. a reject landing on one of them first).
  approveShortlistForVacancy: (vacancyId, approverId) => prisma.application.updateMany({
    where: { vacancyId, status: 'ShortlistProposed' },
    data: { status: 'Shortlisted', shortlistApprovedAt: new Date(), shortlistApprovedById: approverId }
  }),
  // Same Draft exclusion as findByVacancy - a single query in place of the
  // per-vacancy fetch-and-sum HRHome.jsx used to do.
  // Applications an interview can be scheduled for on one vacancy - the
  // Interview Hub's scheduler. Same gate as interviewController's
  // SCHEDULABLE_STATUSES plus no offer yet; ordered like the shortlist.
  findSchedulable: (vacancyId, statuses) => prisma.application.findMany({
    where: { vacancyId, status: { in: statuses }, offer: null },
    select: {
      id: true, status: true, rank: true, listStatus: true, shortlistScore: true,
      candidate: { select: { id: true, fullName: true, email: true, candidateType: true } },
      interviewRounds: {
        select: { id: true, roundNumber: true, status: true, scheduledDate: true, recommendation: true },
        orderBy: { roundNumber: 'asc' }
      }
    },
    orderBy: [{ rank: 'asc' }, { shortlistScore: 'desc' }]
  }),
  // The applications named in a bulk-scheduling request, scoped to the
  // vacancy so ids from another vacancy can't be slipped in.
  findForSession: (vacancyId, ids) => prisma.application.findMany({
    where: { vacancyId, id: { in: ids } },
    select: {
      id: true, status: true, candidateId: true,
      candidate: { select: { id: true, fullName: true } },
      offer: { select: { id: true } }
    }
  }),
  // Shortlisted with nothing scheduled yet - the Hub's "waiting to be
  // scheduled" prompt, per vacancy.
  findShortlistedUnscheduled: () => prisma.application.findMany({
    where: { status: 'Shortlisted', offer: null },
    select: { id: true, vacancy: { select: { id: true, jobRef: true, title: true } } }
  }),
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
