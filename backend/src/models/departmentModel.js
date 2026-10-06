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
    include: {
      directorate: true, createdBy: { select: { name: true } },
      import: { select: { id: true, fileName: true, createdAt: true, createdBy: { select: { name: true } } } }
    },
    orderBy: { createdAt: 'asc' }
  }),
  findAllForAdmin: () => prisma.department.findMany({
    include: { directorate: true },
    orderBy: [{ status: 'asc' }, { name: 'asc' }]
  }),
  // Approve-all for one batch import: only rows still Pending, so a
  // department someone already approved or rejected is left as it is.
  findPendingIdsFromImport: (importId) => prisma.department.findMany({
    where: { importId, status: 'Pending' }, select: { id: true }
  }),
  approveMany: (ids, approvedById) => prisma.department.updateMany({
    where: { id: { in: ids }, status: 'Pending' },
    data: { status: 'Approved', approvedById, approvedAt: new Date(), rejectionReason: null }
  }),
  update: (id, data) => prisma.department.update({ where: { id }, data, include: { directorate: true } }),
  // Used to give propose() an explicit, specific 409 message rather than
  // relying on catching the DB's unique-constraint error.
  findByNameAndDirectorate: (name, directorateId) =>
    prisma.department.findFirst({ where: { name, directorateId } })
};
