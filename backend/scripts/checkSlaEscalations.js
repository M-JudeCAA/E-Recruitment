// Run on a schedule (e.g. hourly via cron), not as an in-process timer -
// the same reasoning already applied elsewhere in this project: scheduled
// logic belongs outside the request-serving Node process, not competing
// with it for the event loop.
// 0 * * * * cd /path/to/backend && node scripts/checkSlaEscalations.js
const prisma = require('../src/config/db');
const slaModel = require('../src/models/slaModel');
const { notifyAllWithRole } = require('../src/services/notificationService');
const { ROLE_RANK } = require('../src/middleware/auth');

// The role exactly one rank above the given one, or null at the top of
// the hierarchy. NOT reused from delegationController - that module's
// tierBelow() answers a different question (self-service delegation:
// who can I delegate DOWN to) since the delegation redesign removed its
// third-party "tier above authorizes" concept entirely. Escalation
// still genuinely needs "who is ABOVE the current tier", so it gets its
// own small copy here rather than depending on a controller whose
// tier-direction no longer matches.
function tierAbove(role) {
  const targetRank = ROLE_RANK[role] + 1;
  return Object.keys(ROLE_RANK).find((r) => ROLE_RANK[r] === targetRank) || null;
}

// The tier a task is FIRST assigned to, before any escalation - matches
// the role permission table exactly (PHRO can recommend an offer but
// never approve it, so OfferApproval starts at Manager).
const INITIAL_TIER = {
  VacancyApproval: 'Principal_HR_Officer',
  DepartmentApproval: 'Principal_HR_Officer',
  OfferApproval: 'Manager'
};

// VacancyApproval is now live, unblocked by the fix to
// Vacancy.create()/approve() - approvedAt gives this a clean, unambiguous
// "awaiting approval" signal for the first time: a vacancy is pending
// exactly when approvedAt is still null and it has not been manually
// withdrawn (status !== 'Closed'). A vacancy Rejected outright would also
// have a null approvedAt, but nothing in this codebase currently sets
// that status on a Vacancy (see the schema comment on VacancyStatus), so
// there is no live path that would wrongly keep escalating a rejected one.
async function getPendingTasks(taskType) {
  if (taskType === 'VacancyApproval') {
    const rows = await prisma.vacancy.findMany({
      where: { approvedAt: null, status: { not: 'Closed' } }
    });
    return rows.map((v) => ({ id: v.id, since: v.createdAt }));
  }
  if (taskType === 'DepartmentApproval') {
    const rows = await prisma.department.findMany({ where: { status: 'Pending' } });
    return rows.map((d) => ({ id: d.id, since: d.createdAt }));
  }
  if (taskType === 'OfferApproval') {
    const rows = await prisma.offer.findMany({ where: { status: 'Recommended' } });
    return rows.map((o) => ({ id: o.id, since: o.recommendedDate }));
  }
  return [];
}

async function main() {
  const now = new Date();
  let totalEscalated = 0;

  for (const taskType of ['VacancyApproval', 'DepartmentApproval', 'OfferApproval']) {
    const pending = await getPendingTasks(taskType);

    for (const task of pending) {
      // Guards against a task with no "since" timestamp (e.g. an Offer
      // recommended before recommendedDate existed) being treated as
      // infinitely overdue - new Date(null) is the 1970 epoch, which
      // would otherwise escalate it instantly and blast a notification.
      if (!task.since) {
        console.warn(`Skipping ${taskType} #${task.id}: no timestamp to measure SLA against.`);
        continue;
      }

      const existingEscalation = await slaModel.findActiveEscalation(taskType, task.id);
      const currentTier = existingEscalation ? existingEscalation.currentTier : INITIAL_TIER[taskType];

      const policy = await slaModel.findPolicy(taskType, currentTier);
      const durationHours = policy ? policy.durationHours : 48; // sensible default if UCAA hasn't set a policy yet

      const assignedAt = existingEscalation ? existingEscalation.escalatedAt : new Date(task.since);
      const hoursWaiting = (now - assignedAt) / (1000 * 60 * 60);

      if (hoursWaiting < durationHours) continue; // still within SLA - nothing to do

      const nextTier = tierAbove(currentTier);
      if (!nextTier) continue; // already at the top tier - nowhere further to escalate

      await slaModel.createEscalation({ taskType, taskId: task.id, currentTier: nextTier });
      await notifyAllWithRole(
        nextTier,
        taskType,
        task.id,
        `A ${taskType.replace(/([A-Z])/g, ' $1').trim()} (#${task.id}) has been waiting ${Math.floor(hoursWaiting)}h and needs your attention. The original assignee can still act too - nothing has been taken from them.`
      );
      totalEscalated++;
    }
  }

  console.log(`SLA check complete. ${totalEscalated} task(s) escalated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
