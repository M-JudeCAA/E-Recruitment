const prisma = require('../config/db');

module.exports = {
  findPolicy: (taskType, tier) => prisma.slaPolicy.findUnique({ where: { taskType_tier: { taskType, tier } } }),
  createEscalation: (data) => prisma.taskEscalation.create({ data }),
  findActiveEscalation: (taskType, taskId) => prisma.taskEscalation.findFirst({
    where: { taskType, taskId, resolvedAt: null },
    orderBy: { escalatedAt: 'desc' }
  }),
  resolveEscalations: (taskType, taskId) => prisma.taskEscalation.updateMany({
    where: { taskType, taskId, resolvedAt: null },
    data: { resolvedAt: new Date() }
  })
};
