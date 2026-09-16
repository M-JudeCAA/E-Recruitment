const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.interviewRound.create({ data }),
  findById: (id) => prisma.interviewRound.findUnique({ where: { id } }),
  update: (id, data) => prisma.interviewRound.update({ where: { id }, data }),
  // Atomic conditional update - scoping the write to recommendation: null
  // means a second finalize call on the same round (double-click, or two
  // HR officers racing) can't silently overwrite an already-finalized
  // recommendation; the caller sees count 0 and reports a conflict instead.
  updateIfNoRecommendation: (id, data) => prisma.interviewRound.updateMany({ where: { id, recommendation: null }, data }),
  countByApplication: (applicationId) => prisma.interviewRound.count({ where: { applicationId } })
};
