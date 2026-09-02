const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.panelAccessToken.create({ data }),
  findByToken: (token) => prisma.panelAccessToken.findUnique({
    where: { token },
    include: {
      panelMember: {
        include: {
          interviewRound: { include: { application: { include: { vacancy: true, candidate: true } } } }
        }
      }
    }
  }),
  markUsed: (id) => prisma.panelAccessToken.update({ where: { id }, data: { usedAt: new Date() } }),
  markAllUsedForPanelMember: (panelMemberId) => prisma.panelAccessToken.updateMany({
    where: { panelMemberId, usedAt: null },
    data: { usedAt: new Date() }
  })
};
