const prisma = require('../config/db');

module.exports = {
  findById: (id) => prisma.department.findUnique({ where: { id }, include: { directorate: true } }),
  create: (data) => prisma.department.create({ data, include: { directorate: true } }),
  // Small tweak vs a naive findMany - order by directorate name first, then
  // department name, so the grouped dropdown renders each directorate's
  // departments together and alphabetically within the group.
  findApproved: () => prisma.department.findMany({
    where: { status: 'Approved' },
    include: { directorate: true },
    orderBy: [{ directorate: { name: 'asc' } }, { name: 'asc' }]
  }),
  findPending: () => prisma.department.findMany({
    where: { status: 'Pending' },
    include: { directorate: true, createdBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' }
  }),
  findAllForAdmin: () => prisma.department.findMany({
    include: { directorate: true },
    orderBy: [{ status: 'asc' }, { name: 'asc' }]
  }),
  update: (id, data) => prisma.department.update({ where: { id }, data, include: { directorate: true } }),
  // Used to give propose() an explicit, specific 409 message rather than
  // relying on catching the DB's unique-constraint error.
  findByNameAndDirectorate: (name, directorateId) =>
    prisma.department.findFirst({ where: { name, directorateId } })
};
