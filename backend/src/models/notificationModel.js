const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.notification.create({ data }),
  findUnreadForStaff: (staffId) => prisma.notification.findMany({
    where: { recipientId: staffId, channel: 'InApp', readAt: null },
    orderBy: { sentAt: 'desc' }
  }),
  markRead: (id) => prisma.notification.update({ where: { id }, data: { readAt: new Date() } }),
  // Idempotency check for one-shot event notifications (e.g.
  // scripts/checkVacancyDeadlines.js) that run on a recurring schedule -
  // without this, a second run would re-notify for the same event every
  // time it fires, exactly the duplicate seen in the orphaned data this
  // feature replaces (see README_notification_task_types.md).
  findByTask: (taskType, taskId) => prisma.notification.findFirst({ where: { taskType, taskId } })
};
