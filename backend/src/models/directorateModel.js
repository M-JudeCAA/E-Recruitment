const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.directorate.create({ data }),
  findAll: () => prisma.directorate.findMany({ orderBy: { name: 'asc' } }),
  findById: (id) => prisma.directorate.findUnique({ where: { id } }),
  findByName: (name) => prisma.directorate.findUnique({ where: { name } })
};
