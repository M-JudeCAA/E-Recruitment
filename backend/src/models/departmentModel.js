const prisma = require('../config/db');

module.exports = {
  findById: (id) => prisma.department.findUnique({ where: { id }, include: { directorate: true } }),
  create: (data) => prisma.department.create({ data, include: { directorate: true } }),
  // Order by directorate first, then department, so the grouped dropdown
  // renders each directorate's departments together and alphabetically
  // within the group.
  // Usable departments: approved, under an approved directorate.
  findApproved: () => prisma.department.findMany({
    where: { status: 'Approved', directorate: { status: 'Approved' } },
    include: { directorate: true },
    orderBy: [{ directorate: { code: 'asc' } }, { name: 'asc' }]
  }),
  findPending: () => prisma.department.findMany({
    where: { status: 'Pending' },
    include: {
      directorate: true, createdBy: { select: { name: true } },
      import: { select: { id: true, fileName: true, createdAt: true, createdById: true, createdBy: { select: { name: true } } } }
    },
    orderBy: { createdAt: 'asc' }
  }),
  update: (id, data) => prisma.department.update({ where: { id }, data, include: { directorate: true } }),
  // Used to give propose() an explicit, specific 409 message rather than
  // relying on catching the DB's unique-constraint error.
  findByNameAndDirectorate: (name, directorateId) =>
    prisma.department.findFirst({ where: { name, directorateId } }),
  findByCodeAndDirectorate: (code, directorateId) =>
    prisma.department.findFirst({ where: { code, directorateId } })
};
