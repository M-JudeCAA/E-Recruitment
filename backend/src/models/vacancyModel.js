const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.vacancy.create({ data }),
  findById: (id) => prisma.vacancy.findUnique({ where: { id } }),
  findMany: (where, orderBy) => prisma.vacancy.findMany({ where, orderBy: orderBy || { createdAt: 'desc' } }),
  findManyForAdmin: (where) => prisma.vacancy.findMany({
    where,
    include: {
      _count: { select: { applications: true } },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' }
  }),
  update: (id, data) => prisma.vacancy.update({ where: { id }, data })
};
