const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.vacancy.create({ data }),
  findById: (id) => prisma.vacancy.findUnique({ where: { id } }),
  update: (id, data) => prisma.vacancy.update({ where: { id }, data }),

  // Used by the job reference generator to detect a same-type,
  // same-month collision and append a distinguishing suffix.
  countByJobRefPrefix: (prefix) => prisma.vacancy.count({
    where: { jobRef: { startsWith: prefix } }
  }),

  // Candidate-facing listing - includes department/directorate and the
  // reports-to position, since the frontend no longer has a plain
  // department string to display directly.
  findManyWithDetails: (where) => prisma.vacancy.findMany({
    where,
    include: {
      department: { include: { directorate: true } },
      position: true,
      reportsToPosition: true
    },
    orderBy: { createdAt: 'desc' }
  }),

  findByIdWithDetails: (id) => prisma.vacancy.findUnique({
    where: { id },
    include: {
      department: { include: { directorate: true } },
      position: true,
      reportsToPosition: true
    }
  }),

  findManyForAdmin: (where) => prisma.vacancy.findMany({
    where,
    include: {
      _count: { select: { applications: true } },
      department: { include: { directorate: true } }
    },
    orderBy: { createdAt: 'desc' }
  })
};
