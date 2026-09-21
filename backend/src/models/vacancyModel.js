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
      // Excludes Draft, same convention as applicationModel.findByVacancy/
      // countAll - a draft isn't yet an application HR has any business
      // seeing, so it shouldn't count as one here either (HRDashboard and
      // HRHome both display this figure).
      _count: { select: { applications: { where: { status: { not: 'Draft' } } } } },
      department: { include: { directorate: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      postingTypeChangedBy: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' }
  })
};
