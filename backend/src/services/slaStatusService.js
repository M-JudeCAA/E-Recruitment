const prisma = require('../config/db');
const slaModel = require('../models/slaModel');
const { ROLE_RANK } = require('../middleware/auth');

// The tier a task is FIRST assigned to, before any escalation - matches the
// role permission table exactly (PHRO can recommend an offer but never
// approve it, so OfferApproval starts at Manager). Shared between
// scripts/checkSlaEscalations.js (the cron job that actually escalates) and
// this module's read-only status reporting, so the two can never drift on
// "who owns this task right now".
const INITIAL_TIER = {
  VacancyApproval: 'Manager',
  DepartmentApproval: 'Principal_HR_Officer',
  DirectorateApproval: 'Principal_HR_Officer',
  PositionApproval: 'Principal_HR_Officer',
  OfferApproval: 'Manager'
};

// The approval queues that are timed and escalated - the one list the
// escalation job, the follow-ups report and the Inbox share.
const SLA_TASK_TYPES = Object.keys(INITIAL_TIER);

// The organisation approvals (orgApprovalService): pending directorates,
// departments and positions, each carrying the import it came from, so the
// escalation job can tell one import's items apart and notify once for them.
const ORG_TASKS = {
  DirectorateApproval: {
    model: 'directorate',
    select: { name: true },
    label: (r) => `Directorate ${r.name}`
  },
  DepartmentApproval: {
    model: 'department',
    select: { name: true, directorate: { select: { name: true } } },
    label: (r) => `${r.name} (${r.directorate.name})`
  },
  PositionApproval: {
    model: 'position',
    select: { name: true, department: { select: { name: true, directorate: { select: { name: true } } } } },
    label: (r) => `${r.name} in ${r.department.name} (${r.department.directorate.name})`
  }
};

// The role exactly one rank above the given one, or null at the top of the
// hierarchy. Kept here (not in delegationController) because that module's
// tierBelow() answers a different question - see scripts/checkSlaEscalations.js's
// original copy of this same comment.
function tierAbove(role) {
  const targetRank = ROLE_RANK[role] + 1;
  return Object.keys(ROLE_RANK).find((r) => ROLE_RANK[r] === targetRank) || null;
}

// Every currently-open task of one type, across the three queues
// ApprovalsCenter.jsx already unifies - same underlying "is this still
// pending" condition as that screen's own fetches, just with a label/link
// resolved server-side so the follow-ups endpoint doesn't need three round
// trips from the client.
async function getPendingTasks(taskType) {
  if (taskType === 'VacancyApproval') {
    const rows = await prisma.vacancy.findMany({
      // Only while it is actually waiting on an approver - not once it has
      // been returned to HR, rejected or closed. The clock restarts when a
      // returned vacancy is resubmitted.
      where: { approvedAt: null, status: 'PendingApproval' },
      select: { id: true, createdAt: true, approvalRequestedAt: true, jobRef: true, title: true }
    });
    return rows.map((v) => ({
      id: v.id, since: v.approvalRequestedAt || v.createdAt, label: `${v.jobRef} — ${v.title}`, to: `/hr/vacancy/${v.id}`
    }));
  }
  if (ORG_TASKS[taskType]) {
    const spec = ORG_TASKS[taskType];
    const rows = await prisma[spec.model].findMany({
      where: { status: 'Pending' },
      select: { id: true, createdAt: true, importId: true, import: { select: { fileName: true } }, ...spec.select }
    });
    return (rows || []).map((r) => ({
      id: r.id, since: r.createdAt, label: spec.label(r), to: '/hr/departments',
      importId: r.importId || null, importName: r.import?.fileName || null
    }));
  }
  if (taskType === 'OfferApproval') {
    const rows = await prisma.offer.findMany({
      where: { status: 'Recommended' },
      select: {
        id: true, recommendedDate: true,
        application: { select: { vacancyId: true, candidate: { select: { fullName: true } }, vacancy: { select: { title: true } } } }
      }
    });
    return rows.map((o) => ({
      id: o.id, since: o.recommendedDate,
      label: `${o.application.candidate.fullName} — ${o.application.vacancy.title}`,
      to: `/hr/vacancy/${o.application.vacancyId}?tab=merit`
    }));
  }
  return [];
}

// Due-date/urgency math for one pending task - factored out so both the
// cron script (which acts on it) and the read-only /dashboard/follow-ups
// endpoint (which only reports it) compute "is this overdue" identically.
async function computeStatus(taskType, task) {
  // Guards against a task with no "since" timestamp (e.g. an Offer
  // recommended before recommendedDate existed) reading as infinitely
  // overdue - same guard scripts/checkSlaEscalations.js already applies.
  if (!task.since) return null;

  const [existingEscalation, escalationCount] = await Promise.all([
    slaModel.findActiveEscalation(taskType, task.id),
    slaModel.countEscalations(taskType, task.id)
  ]);
  const currentTier = existingEscalation ? existingEscalation.currentTier : INITIAL_TIER[taskType];

  const policy = await slaModel.findPolicy(taskType, currentTier);
  const durationHours = policy ? policy.durationHours : 48; // same sensible default as the cron script

  const assignedAt = existingEscalation ? existingEscalation.escalatedAt : new Date(task.since);
  const dueAt = new Date(assignedAt.getTime() + durationHours * 60 * 60 * 1000);
  const hoursRemaining = (dueAt - Date.now()) / (1000 * 60 * 60);

  return {
    taskType,
    taskId: task.id,
    label: task.label,
    to: task.to,
    importId: task.importId || null,
    since: task.since,
    currentTier,
    dueAt,
    hoursRemaining,
    isOverdue: hoursRemaining <= 0,
    escalated: escalationCount > 0
  };
}

// Every open task across the approval queues, annotated with SLA status,
// overdue-first then soonest-due (GET /api/dashboard/follow-ups; the
// Organisation page uses it to mark overdue items).
async function getPendingTasksWithStatus() {
  const perType = await Promise.all(SLA_TASK_TYPES.map(async (taskType) => {
    const tasks = await getPendingTasks(taskType);
    const statuses = await Promise.all(tasks.map((task) => computeStatus(taskType, task)));
    return statuses.filter(Boolean);
  }));

  return perType.flat().sort((a, b) => (
    a.isOverdue !== b.isOverdue ? (a.isOverdue ? -1 : 1) : a.dueAt - b.dueAt
  ));
}

module.exports = { INITIAL_TIER, SLA_TASK_TYPES, tierAbove, getPendingTasks, computeStatus, getPendingTasksWithStatus };
