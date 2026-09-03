const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.position.create({ data }),
  findById: (id) => prisma.position.findUnique({ where: { id }, include: { department: { include: { directorate: true } } } }),

  // Powers the grouped Position dropdown on the vacancy form - every
  // position, with its department and directorate attached, so the
  // frontend can group by directorate then department without a second
  // round trip per position.
  findAllForDropdown: () => prisma.position.findMany({
    include: { department: { include: { directorate: true } } },
    orderBy: [
      { department: { directorate: { name: 'asc' } } },
      { department: { name: 'asc' } },
      { level: 'asc' }
    ]
  }),

  // Reports-To options: positions in the SAME department record (not
  // just the same department name - CWG under CORP and CWG under DANS
  // are different department rows) with a strictly higher level.
  findSeniorInDepartment: (departmentId, minLevel) => prisma.position.findMany({
    where: { departmentId, level: { gt: minLevel } },
    orderBy: { level: 'asc' }
  }),

  findByDepartment: (departmentId) => prisma.position.findMany({
    where: { departmentId },
    orderBy: { level: 'asc' }
  })
};
