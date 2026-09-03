const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.notification.create({ data }),
  findUnreadForStaff: (staffId) => prisma.notification.findMany({
    where: { recipientId: staffId, channel: 'InApp', readAt: null },
    orderBy: { sentAt: 'desc' }
  }),
  markRead: (id) => prisma.notification.update({ where: { id }, data: { readAt: new Date() } })
};
