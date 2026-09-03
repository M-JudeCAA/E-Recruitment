const prisma = require('../config/db');

module.exports = {
  findByEmail: (email) => prisma.staffUser.findUnique({ where: { email } }),
  findById: (id) => prisma.staffUser.findUnique({ where: { id } }),
  create: (data) => prisma.staffUser.create({ data }),
  update: (id, data) => prisma.staffUser.update({ where: { id }, data }),

  // For the staff admin listing - excludes nothing by role, since PHRO+
  // should be able to see the whole HR team, not just who they can edit.
  findAllHRAndBelow: () => prisma.staffUser.findMany({
    select: { id: true, name: true, email: true, role: true, department: true },
    orderBy: { name: 'asc' }
  })
};
