const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.directorate.create({ data }),
  findAll: () => prisma.directorate.findMany({ orderBy: { name: 'asc' } }),
  findPending: () => prisma.directorate.findMany({
    where: { status: 'Pending' },
    include: {
      createdBy: { select: { name: true } },
      import: { select: { id: true, fileName: true, createdAt: true, createdById: true, createdBy: { select: { name: true } } } }
    },
    orderBy: { createdAt: 'asc' }
  }),
  findById: (id) => prisma.directorate.findUnique({ where: { id } }),
  findByName: (name) => prisma.directorate.findUnique({ where: { name } })
};
