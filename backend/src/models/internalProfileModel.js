const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.internalProfile.create({ data }),
  updateByCandidateId: (candidateId, data) =>
    prisma.internalProfile.update({ where: { candidateId }, data })
};
