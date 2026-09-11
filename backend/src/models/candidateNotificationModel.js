const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.candidateNotification.create({ data }),
  findUnreadForCandidate: (candidateId) => prisma.candidateNotification.findMany({
    where: { candidateId, channel: 'InApp', readAt: null },
    orderBy: { sentAt: 'desc' }
  }),
  // Scoped to candidateId so one candidate can't mark another's
  // notification read by guessing an id.
  markRead: (id, candidateId) => prisma.candidateNotification.updateMany({
    where: { id, candidateId }, data: { readAt: new Date() }
  })
};
