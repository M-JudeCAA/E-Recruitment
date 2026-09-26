const prisma = require('../config/db');

const VACANCY_STATUSES = ['PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed'];
const APPLICATION_STATUSES = ['Submitted', 'ShortlistProposed', 'Shortlisted', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn'];
const OFFER_STATUSES = ['Recommended', 'Approved', 'Extended', 'Accepted', 'Declined'];

module.exports = {
  VACANCY_STATUSES,
  APPLICATION_STATUSES,
  OFFER_STATUSES,

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
  // Offer outcomes by status - the Trend/Funnel panels' "Accepted" figure
  // isn't reachable from applicationsByStatus (Application.status never
  // reaches an "Accepted" value of its own; the acceptance lives on Offer).
  countOffersByStatus: () => Promise.all(
    OFFER_STATUSES.map((status) => prisma.offer.count({ where: { status } }).then((count) => [status, count]))
  ),

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
  }),

  // Raw timestamps for the trend chart's three series, bucketed into
  // per-day counts in JS rather than a Prisma groupBy - same reasoning as
  // vacanciesForHeadcount above: this codebase doesn't reach for raw
  // date-trunc SQL anywhere, and these tables are never large enough for
  // that to matter. `since` is the start of the requested window.
  applicationsCreatedSince: (since) => prisma.application.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true }
  }),
  vacanciesApprovedSince: (since) => prisma.vacancy.findMany({
    where: { approvedAt: { gte: since } },
    select: { approvedAt: true }
  }),
  offersApprovedSince: (since) => prisma.offer.findMany({
    where: { approvedDate: { gte: since } },
    select: { approvedDate: true }
  }),

  // Every resolved (approved or rejected) task across the three
  // SLA-tracked queues, each shaped identically ({taskType, taskId, since,
  // resolvedAt, approverId, approverName}) so the Analytics controller can
  // combine them into one list for SLA-compliance and approval-turnaround
  // reporting without three separate code paths. `since`/`resolvedAt`
  // mirror the exact fields checkSlaEscalations.js/slaStatusService.js use
  // for the same taskType while still pending.
  resolvedVacancyApprovals: () => prisma.vacancy.findMany({
    where: { approvedAt: { not: null } },
    select: { id: true, createdAt: true, approvedAt: true, approvedById: true, approvedBy: { select: { name: true } } }
  }),
  resolvedDepartmentApprovals: () => prisma.department.findMany({
    where: { approvedAt: { not: null } },
    select: { id: true, createdAt: true, approvedAt: true, approvedById: true, approvedBy: { select: { name: true } } }
  }),
  resolvedOfferApprovals: () => prisma.offer.findMany({
    where: { approvedDate: { not: null } },
    select: { id: true, recommendedDate: true, approvedDate: true, approvedById: true, approvedBy: { select: { name: true } } }
  }),
  // Every taskType+taskId that was ever escalated at least once - a
  // resolved task absent from this set cleared its SLA without breaching;
  // one present in it was decided only after escalating past its first
  // tier. Only the two identifying columns are needed (see
  // dashboardController.analyticsSlaCompliance/analyticsApprovalTurnaround).
  allEscalatedTaskKeys: () => prisma.taskEscalation.findMany({ select: { taskType: true, taskId: true } }),

  // Offers with a candidate decision on file - see the schema comment on
  // Offer.decidedAt for why this can't be reconstructed from approvedDate.
  decidedOffers: () => prisma.offer.findMany({
    where: { decidedAt: { not: null } },
    select: { decidedAt: true, status: true }
  }),

  // Vacancies that have ever reached Filled - see the schema comment on
  // Vacancy.filledAt. approvedAt is the "went live" timestamp time-to-fill
  // measures from.
  filledVacancies: () => prisma.vacancy.findMany({
    where: { filledAt: { not: null } },
    select: { filledAt: true, approvedAt: true, postingType: true }
  }),

  // Most recent delegation actions, each with delegator/delegate names
  // resolved - the Delegation Activity list on the Analytics page.
  recentDelegationUsage: (take) => prisma.delegationUsage.findMany({
    orderBy: { usedAt: 'desc' },
    take,
    include: {
      delegation: {
        select: {
          delegator: { select: { name: true } },
          delegate: { select: { name: true } }
        }
      }
    }
  }),

  // Every scored panel member row - grouped by name (not staffUserId,
  // which is optional/absent for the common case of an external panelist
  // with no system account, see the schema comment on PanelMember) in the
  // controller to build the workload/average-score table.
  scoredPanelMembers: () => prisma.panelMember.findMany({
    // A panelist who stood down (recusedAt) didn't count towards the round,
    // so they don't count here either.
    where: { score: { not: null }, recusedAt: null },
    select: { name: true, score: true }
  }),

  // Interview rounds scheduled within a window - HRHome's "Upcoming
  // interviews" panel.
  interviewRoundsScheduledBetween: (from, to) => prisma.interviewRound.findMany({
    // Cancelled/no-show rounds are not upcoming interviews.
    where: { scheduledDate: { gte: from, lte: to }, status: 'Scheduled' },
    orderBy: { scheduledDate: 'asc' },
    select: {
      id: true, scheduledDate: true, mode: true, roundNumber: true,
      durationMinutes: true, location: true, candidateResponse: true,
      application: {
        select: {
          candidate: { select: { fullName: true } },
          vacancy: { select: { id: true, title: true, jobRef: true } }
        }
      }
    }
  }),

  // Screening outcome counts - Application.screeningPassed/screeningReasons
  // are only populated once a vacancy's review has begun (see
  // applicationDraftController.submit/vacancyReviewBatchController.js), so
  // "not yet screened" (screeningPassed still null on a non-Draft
  // application) is a real, meaningful third bucket, not a data gap.
  countApplicationsByScreeningOutcome: () => Promise.all([
    prisma.application.count({ where: { screeningPassed: true } }).then((n) => ['passed', n]),
    prisma.application.count({ where: { screeningPassed: false } }).then((n) => ['failed', n]),
    prisma.application.count({ where: { screeningPassed: null, status: { not: 'Draft' } } }).then((n) => ['notYetScreened', n])
  ]),
  // Raw reasons for every screening failure - categorized client-side in
  // the controller (screeningReasons is a JSON-stringified free-text
  // array, see screeningService.screenApplication's `reasons`).
  screeningFailureReasons: () => prisma.application.findMany({
    where: { screeningPassed: false },
    select: { screeningReasons: true }
  })
};
