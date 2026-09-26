const prisma = require('../config/db');

function toRow(interviewRoundId, p) {
  return {
    interviewRoundId,
    name: String(p.name).trim(),
    trade: p.trade ? String(p.trade).trim() : null,
    email: p.email ? String(p.email).trim() : null,
    staffUserId: Number.isInteger(p.staffUserId) ? p.staffUserId : null,
    isChair: !!p.isChair
  };
}

module.exports = {
  createMany: (interviewRoundId, panelists) => prisma.panelMember.createMany({
    data: panelists.map((p) => toRow(interviewRoundId, p))
  }),
  create: (data) => prisma.panelMember.create({ data }),
  findByRound: (interviewRoundId) => prisma.panelMember.findMany({ where: { interviewRoundId } }),
  findById: (id) => prisma.panelMember.findUnique({ where: { id } }),
  findWithRound: (id) => prisma.panelMember.findUnique({ where: { id }, include: { interviewRound: true } }),
  update: (id, data) => prisma.panelMember.update({ where: { id }, data }),
  // Only one chair per round - clearing the others before setting a new one.
  clearChair: (interviewRoundId) => prisma.panelMember.updateMany({
    where: { interviewRoundId, isChair: true }, data: { isChair: false }
  }),
  // Removing a panelist deletes their (never-used or revoked) access tokens
  // first - the token rows hold a foreign key to the panel member.
  remove: (id) => prisma.$transaction([
    prisma.panelAccessToken.deleteMany({ where: { panelMemberId: id } }),
    prisma.panelMember.delete({ where: { id } })
  ]),
  // Distinct panelists used on a vacancy before - the scheduler's "reuse
  // panel" suggestions.
  findUsedOnVacancy: (vacancyId) => prisma.panelMember.findMany({
    where: { interviewRound: { application: { vacancyId } } },
    select: { name: true, trade: true, email: true, staffUserId: true, isChair: true },
    orderBy: { id: 'desc' },
    take: 200
  }),
  toRow
};
