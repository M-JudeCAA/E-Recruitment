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
  }),
  // A cancelled or no-show round: every panelist's outstanding link stops
  // working at once.
  markAllUsedForRound: (interviewRoundId) => prisma.panelAccessToken.updateMany({
    where: { usedAt: null, panelMember: { interviewRoundId } },
    data: { usedAt: new Date() }
  }),
  // Which panelists on a round currently hold a working link - the Hub
  // shows "link sent" against them.
  findActiveForRound: (interviewRoundId) => prisma.panelAccessToken.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() }, panelMember: { interviewRoundId } },
    select: { panelMemberId: true, expiresAt: true, createdAt: true }
  })
};
