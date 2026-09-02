const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.offer.create({ data }),
  findById: (id) => prisma.offer.findUnique({ where: { id }, include: { application: true } }),
  update: (id, data) => prisma.offer.update({ where: { id }, data, include: { application: true } })
};
