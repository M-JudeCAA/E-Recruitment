// Run on a schedule (e.g. hourly via cron), not as an in-process timer -
// the same reasoning already applied elsewhere in this project: scheduled
// logic belongs outside the request-serving Node process, not competing
// with it for the event loop.
// 0 * * * * cd /path/to/backend && node scripts/checkSlaEscalations.js
const slaModel = require('../src/models/slaModel');
const { notifyAllWithRole } = require('../src/services/notificationService');
// getPendingTasks/INITIAL_TIER/tierAbove now live in slaStatusService,
// shared with the read-only GET /api/dashboard/follow-ups endpoint so the
// two can never disagree on "who owns this task right now" or "is it
// overdue" - this script is the only one of the two with side effects
// (it's what actually creates the escalation + fires the notification).
const { INITIAL_TIER, tierAbove, getPendingTasks } = require('../src/services/slaStatusService');
const prisma = require('../src/config/db');

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
