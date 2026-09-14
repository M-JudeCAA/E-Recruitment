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
  }),
  // Backs the Manager/Director Approvals Center - every offer a Principal
  // HR Officer has recommended but that hasn't yet been approved (or
  // declined by the candidate, which never applies at this status).
  // Oldest-recommended-first, so the longest-waiting offer surfaces at the
  // top of the queue rather than the most recent.
  findManyPendingApproval: () => prisma.offer.findMany({
    where: { status: 'Recommended' },
    include: {
      recommendedBy: { select: { name: true } },
      application: {
        include: {
          candidate: { select: { fullName: true, candidateType: true } },
          vacancy: { select: { id: true, jobRef: true, title: true } }
        }
      }
    },
    orderBy: { recommendedDate: 'asc' }
  })
};
