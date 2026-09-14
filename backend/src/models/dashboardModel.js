const prisma = require('../config/db');

const VACANCY_STATUSES = ['PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed'];
const APPLICATION_STATUSES = ['Submitted', 'Shortlisted', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn'];

module.exports = {
  VACANCY_STATUSES,
  APPLICATION_STATUSES,

  // One count() per status rather than a single groupBy - keeps this
  // trivially mockable the same way every other model in this codebase
  // is (a plain jest.fn() per Prisma method), and the table sizes here
  // never make N small counts meaningfully slower than one grouped query.
  countVacanciesByStatus: () => Promise.all(
    VACANCY_STATUSES.map((status) => prisma.vacancy.count({ where: { status } }).then((count) => [status, count]))
  ),
  countApplicationsByStatus: () => Promise.all(
    APPLICATION_STATUSES.map((status) => prisma.application.count({ where: { status } }).then((count) => [status, count]))
  ),
  countPendingDepartments: () => prisma.department.count({ where: { status: 'Pending' } }),
  countOffersPendingApproval: () => prisma.offer.count({ where: { status: 'Recommended' } }),

  // Executive activity feed - built from the timestamped audit fields
  // already on Vacancy/Offer/Department (approvedAt, postingTypeChangedAt,
  // approvedDate) rather than the AuditLog table, which only captures a
  // handful of unrelated event types (qualification snapshots, supervisor
  // notifications) and was never written to for approvals themselves - see
  // workflowService.js. These fields are the actual source of truth for
  // "who approved what, and when".
  recentApprovedVacancies: (take) => prisma.vacancy.findMany({
    where: { approvedAt: { not: null } },
    orderBy: { approvedAt: 'desc' },
    take,
    select: { id: true, jobRef: true, title: true, approvedAt: true, approvedByRole: true, approvedBy: { select: { name: true } } }
  }),
  recentPostingTypeTransitions: (take) => prisma.vacancy.findMany({
    where: { postingTypeChangedAt: { not: null } },
    orderBy: { postingTypeChangedAt: 'desc' },
    take,
    select: {
      id: true, jobRef: true, title: true, postingType: true, postingTypePreviousValue: true,
      postingTypeChangedAt: true, postingTypeChangedBy: { select: { name: true } }
    }
  }),
  recentApprovedOffers: (take) => prisma.offer.findMany({
    where: { approvedDate: { not: null } },
    orderBy: { approvedDate: 'desc' },
    take,
    include: {
      approvedBy: { select: { name: true } },
      application: { include: { candidate: { select: { fullName: true } }, vacancy: { select: { title: true, jobRef: true } } } }
    }
  }),
  recentApprovedDepartments: (take) => prisma.department.findMany({
    where: { approvedAt: { not: null } },
    orderBy: { approvedAt: 'desc' },
    take,
    include: { approvedBy: { select: { name: true } }, directorate: { select: { name: true } } }
  }),

  // Org-wide headcount snapshot for the executive dashboard's directorate
  // breakdown - every Open/PartiallyFilled/Filled vacancy (the ones that
  // ever had a real headcount need), grouped by directorate client-side
  // since Prisma's groupBy can't reach through a nested relation.
  vacanciesForHeadcount: () => prisma.vacancy.findMany({
    where: { status: { in: ['Open', 'PartiallyFilled', 'Filled'] } },
    select: {
      positionsRequired: true, status: true,
      department: { select: { name: true, directorate: { select: { name: true } } } }
    }
  })
};
