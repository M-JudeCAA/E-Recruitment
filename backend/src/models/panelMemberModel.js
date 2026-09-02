const prisma = require('../config/db');

module.exports = {
  createMany: (interviewRoundId, panelists) => prisma.panelMember.createMany({
    data: panelists.map((p) => ({
      interviewRoundId,
      name: p.name,
      trade: p.trade || null,
      email: p.email || null
    }))
  }),
  create: (data) => prisma.panelMember.create({ data }),
  findByRound: (interviewRoundId) => prisma.panelMember.findMany({ where: { interviewRoundId } }),
  findById: (id) => prisma.panelMember.findUnique({ where: { id } }),
  update: (id, data) => prisma.panelMember.update({ where: { id }, data })
};
