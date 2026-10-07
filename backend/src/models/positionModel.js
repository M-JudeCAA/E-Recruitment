const prisma = require('../config/db');

// Only an approved position in an approved department under an approved
// directorate can be chosen on a vacancy (orgApprovalService.usablePosition).
const USABLE = { status: 'Approved', department: { status: 'Approved', directorate: { status: 'Approved' } } };

module.exports = {
  create: (data) => prisma.position.create({ data }),
  findById: (id) => prisma.position.findUnique({ where: { id }, include: { department: { include: { directorate: true } } } }),

  // Powers the grouped Position dropdown on the vacancy form - every usable
  // position, with its department and directorate attached, so the frontend
  // can group by directorate then department without a second round trip.
  findAllForDropdown: () => prisma.position.findMany({
    where: USABLE,
    include: { department: { include: { directorate: true } } },
    orderBy: [
      { department: { directorate: { name: 'asc' } } },
      { department: { name: 'asc' } },
      { level: 'asc' }
    ]
  }),

  // Reports-To options: approved positions in the SAME department record
  // (not just the same department name - CWG under CORP and CWG under DANS
  // are different department rows) with a strictly higher level.
  findSeniorInDepartment: (departmentId, minLevel) => prisma.position.findMany({
    where: { departmentId, level: { gt: minLevel }, status: 'Approved' },
    orderBy: { level: 'asc' }
  }),

  findByDepartment: (departmentId) => prisma.position.findMany({
    where: { departmentId, status: 'Approved' },
    orderBy: { level: 'asc' }
  }),

  findPending: () => prisma.position.findMany({
    where: { status: 'Pending' },
    include: {
      department: { include: { directorate: true } },
      createdBy: { select: { name: true } },
      import: { select: { id: true, fileName: true, createdAt: true, createdById: true, createdBy: { select: { name: true } } } }
    },
    orderBy: { createdAt: 'asc' }
  })
};
