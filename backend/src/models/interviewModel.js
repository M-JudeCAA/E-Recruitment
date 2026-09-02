const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.interviewRound.create({ data }),
  update: (id, data) => prisma.interviewRound.update({ where: { id }, data }),
  countByApplication: (applicationId) => prisma.interviewRound.count({ where: { applicationId } })
};
