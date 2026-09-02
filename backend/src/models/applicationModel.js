const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.application.create({ data }),
  findById: (id, include) => prisma.application.findUnique({ where: { id }, include }),
  findFirst: (where) => prisma.application.findFirst({ where }),
  findByVacancy: (vacancyId) => prisma.application.findMany({
    where: { vacancyId },
    include: {
      candidate: { include: { internalProfile: true, workExperience: true, education: true } },
      interviewRounds: true,
      offer: true
    },
    orderBy: [{ rank: 'asc' }, { shortlistScore: 'desc' }]
  }),
  findByCandidate: (candidateId) => prisma.application.findMany({
    where: { candidateId },
    include: { vacancy: true, interviewRounds: true, offer: true },
    orderBy: { createdAt: 'desc' }
  }),
  findOwnedByCandidate: (candidateId, urls) => prisma.application.findFirst({
    where: { candidateId, OR: [{ cvUrl: urls }, { coverLetterUrl: urls }] }
  }),
  update: (id, data) => prisma.application.update({ where: { id }, data })
};
