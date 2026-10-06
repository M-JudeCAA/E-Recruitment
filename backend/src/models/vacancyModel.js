const prisma = require('../config/db');
const { typeCodeFor, refYear, formatJobRef } = require('../utils/jobRefGenerator');

module.exports = {
  create: (data) => prisma.vacancy.create({ data }),
  findById: (id) => prisma.vacancy.findUnique({ where: { id } }),
  update: (id, data) => prisma.vacancy.update({ where: { id }, data }),
  // Only if the vacancy is still at `status` - two approvers acting on the
  // same vacancy at once can't both succeed. { count } like updateMany.
  // `where` adds conditions (approve: unchanged since the approver looked).
  updateIfStatus: (id, status, data, where = {}) => prisma.vacancy.updateMany({ where: { id, status, ...where }, data }),

  // Creates a vacancy with the next job reference for its posting type and
  // year (see utils/jobRefGenerator.js). The upsert takes the counter row's
  // lock and holds it until commit, so concurrent creates are numbered one
  // after the other, and a failed create rolls its number back.
  createWithJobRef: (postingType, data, now = new Date()) => prisma.$transaction(async (tx) => {
    const typeCode = typeCodeFor(postingType);
    const year = refYear(now);
    await tx.$executeRaw`INSERT INTO JobRefSequence (typeCode, year, lastNumber) VALUES (${typeCode}, ${year}, 1)
      ON DUPLICATE KEY UPDATE lastNumber = lastNumber + 1`;
    const sequence = await tx.jobRefSequence.findUnique({ where: { typeCode_year: { typeCode, year } } });
    return tx.vacancy.create({ data: { ...data, jobRef: formatJobRef(typeCode, sequence.lastNumber, year) } });
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
