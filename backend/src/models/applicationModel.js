const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.application.create({ data }),
  findById: (id, include) => prisma.application.findUnique({ where: { id }, include }),
  findFirst: (where) => prisma.application.findFirst({ where }),
  // Excludes Draft - a draft is not yet an application HR has any
  // business seeing; it only becomes visible to HR once the candidate
  // actually submits it. Only reachable as a real, populated status once
  // the draft/submit split exists (previously every row was created
  // straight at Submitted, so this filter had nothing to do).
  findByVacancy: (vacancyId) => prisma.application.findMany({
    where: { vacancyId, status: { not: 'Draft' } },
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
  findByVacancyAndStatus: (vacancyId, status) => prisma.application.findMany({
    where: { vacancyId, status }
  }),
  update: (id, data) => prisma.application.update({ where: { id }, data }),
  // Used only for cancelling a Draft (never a Submitted-or-later
  // application) - see applicationDraftController.withdraw. Deleting the
  // row, rather than marking it Withdrawn, frees the (vacancyId,
  // candidateId) uniqueness slot so the candidate can start again.
  remove: (id) => prisma.application.delete({ where: { id } })
};
