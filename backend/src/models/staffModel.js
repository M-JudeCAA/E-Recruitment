const prisma = require('../config/db');

module.exports = {
  findByEmail: (email) => prisma.staffUser.findUnique({ where: { email } }),
  update: (id, data) => prisma.staffUser.update({ where: { id }, data })
};
