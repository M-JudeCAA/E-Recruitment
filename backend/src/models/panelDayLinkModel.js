const prisma = require('../config/db');

// A panelist's scoring link for one interview day of one vacancy - see
// PanelDayLink in schema.prisma and panelDayLinkService.js.
module.exports = {
  create: (data) => prisma.panelDayLink.create({ data }),
  findByToken: (token) => prisma.panelDayLink.findUnique({
    where: { token },
    include: { vacancy: { select: { id: true, jobRef: true, title: true } } }
  }),
  // Every link still in force for a vacancy's day, one per panelist at most
  // (issuing a fresh one revokes the old).
  findActive: (vacancyId, day) => prisma.panelDayLink.findMany({
    where: { vacancyId, day, revokedAt: null }
  }),
  revoke: (ids) => prisma.panelDayLink.updateMany({
    where: { id: { in: ids }, revokedAt: null },
    data: { revokedAt: new Date() }
  })
};
