// Run on a schedule, not as an in-process timer inside the API - scheduled
// logic belongs outside the request-serving Node process, not competing
// with it for the event loop. Normally run hourly by the scheduler worker
// (`npm run jobs`, scripts/scheduler.js); can also be run directly from
// cron / Task Scheduler:
// 0 * * * * cd /path/to/backend && node scripts/checkSlaEscalations.js
// Either way each run is recorded in SystemHealth, so staff are warned if
// it stops running (services/systemHealthService.js).
// Loads SMTP_* etc. from backend/.env when run directly. Prisma reads
// DATABASE_URL from .env on its own, but the mailer does not - without
// this, emails sent from a cron-run script always failed.
require('dotenv').config();
const slaModel = require('../src/models/slaModel');
const { notifyAllWithRole } = require('../src/services/notificationService');
// getPendingTasks/INITIAL_TIER/tierAbove live in slaStatusService, shared
// with the read-only GET /api/dashboard/follow-ups endpoint and the Inbox so
// they can never disagree on "who owns this task right now" or "is it
// overdue" - this script is the only one with side effects (it's what
// actually creates the escalation + fires the notification).
const { INITIAL_TIER, SLA_TASK_TYPES, tierAbove, getPendingTasks } = require('../src/services/slaStatusService');

const WORDS = {
  VacancyApproval: 'vacancy approval',
  DepartmentApproval: 'department approval',
  DirectorateApproval: 'directorate approval',
  PositionApproval: 'position approval',
  OfferApproval: 'offer approval'
};

async function run() {
  const now = new Date();
  let totalEscalated = 0;
  // Organisation items from one spreadsheet import escalate together - one
  // notification per import and tier, not one per row.
  const importNotices = new Map(); // `${importId}:${tier}` -> { tier, taskType, taskId, importName, count, hours }

  for (const taskType of SLA_TASK_TYPES) {
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
      totalEscalated++;

      if (task.importId) {
        const key = `${task.importId}:${nextTier}`;
        const notice = importNotices.get(key) || { tier: nextTier, taskType, taskId: task.id, importName: task.importName, count: 0, hours: 0 };
        notice.count += 1;
        notice.hours = Math.max(notice.hours, Math.floor(hoursWaiting));
        importNotices.set(key, notice);
        continue;
      }
      await notifyAllWithRole(
        nextTier,
        taskType,
        task.id,
        `A ${WORDS[taskType] || taskType} (${task.label || `#${task.id}`}) has been waiting ${Math.floor(hoursWaiting)}h and needs your attention. The original assignee can still act too - nothing has been taken from them.`
      );
    }
  }

  for (const notice of importNotices.values()) {
    await notifyAllWithRole(
      notice.tier,
      notice.taskType,
      notice.taskId,
      `${notice.count} item(s) imported from ${notice.importName || 'a spreadsheet'} have been waiting ${notice.hours}h for approval and need your attention (Organisation page). The original assignee can still act too - nothing has been taken from them.`
    );
  }

  return `SLA check complete. ${totalEscalated} task(s) escalated.`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('checkSlaEscalations', run);
}
