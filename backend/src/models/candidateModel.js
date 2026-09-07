const prisma = require('../config/db');

module.exports = {
  findByEmail: (email) => prisma.candidate.findUnique({ where: { email } }),
  findById: (id, include) => prisma.candidate.findUnique({ where: { id }, include }),
  create: (data) => prisma.candidate.create({ data }),
  update: (id, data) => prisma.candidate.update({ where: { id }, data }),
  findByIdWithRecords: (id) => prisma.candidate.findUnique({
    where: { id },
    include: { education: true, workExperience: true }
  })
};
