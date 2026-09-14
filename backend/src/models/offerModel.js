const prisma = require('../config/db');

// application.vacancy is included alongside the plain application row so
// approveOffer/acceptOffer/declineOffer can build a candidate-facing
// message (vacancy title) without a second query - application.vacancyId
// itself is unaffected and still readable as before.
const include = { application: { include: { vacancy: true } } };

module.exports = {
  create: (data) => prisma.offer.create({ data }),
  findById: (id) => prisma.offer.findUnique({ where: { id }, include }),
  update: (id, data) => prisma.offer.update({ where: { id }, data, include }),
  countAccepted: (vacancyId) => prisma.offer.count({
    where: { status: 'Accepted', application: { vacancyId } }
  })
};
