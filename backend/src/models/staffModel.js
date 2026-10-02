const prisma = require('../config/db');

const ADMIN_LIST_FIELDS = {
  id: true, name: true, email: true, role: true, department: true,
  isSystemAdmin: true, active: true, lastLoginAt: true, entraObjectId: true, createdAt: true
};

module.exports = {
  findByEmail: (email) => prisma.staffUser.findUnique({ where: { email } }),
  findById: (id) => prisma.staffUser.findUnique({ where: { id } }),
  findByEntraObjectId: (entraObjectId) => prisma.staffUser.findUnique({ where: { entraObjectId } }),
  create: (data) => prisma.staffUser.create({ data }),
  update: (id, data) => prisma.staffUser.update({ where: { id }, data }),

  // Read on every role-gated staff request (middleware/auth.js), so a
  // deactivation or role change takes effect at once rather than when the
  // session token expires.
  findAuthState: (id) => prisma.staffUser.findUnique({
    where: { id },
    select: { id: true, role: true, isSystemAdmin: true, active: true }
  }),

  // The HR directory - for delegation and the like. Only active staff
  // holding an HR role; an accounts-only administrator isn't on the team.
  findAllHRAndBelow: () => prisma.staffUser.findMany({
    where: { active: true, role: { not: null } },
    select: { id: true, name: true, email: true, role: true, department: true },
    orderBy: { name: 'asc' }
  }),

  // Every account, for the system administrator's screen. Whether the
  // account is linked to a Microsoft identity is shown, not the id itself.
  findAllForAdmin: async () => {
    const rows = await prisma.staffUser.findMany({ select: ADMIN_LIST_FIELDS, orderBy: { name: 'asc' } });
    return rows.map(({ entraObjectId, ...row }) => ({ ...row, linked: Boolean(entraObjectId) }));
  },

  countActiveAdmins: () => prisma.staffUser.count({ where: { isSystemAdmin: true, active: true } })
};
