const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.internalProfile.create({ data }),
  findByCandidateId: (candidateId) => prisma.internalProfile.findUnique({ where: { candidateId } }),
  updateByCandidateId: (candidateId, data) =>
    prisma.internalProfile.update({ where: { candidateId }, data })
};
