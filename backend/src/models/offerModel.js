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
  // Atomic conditional update, same pattern as applicationModel.updateIfStatus -
  // scoping the write itself to status: expectedStatus means only the first
  // of two near-simultaneous actions on this offer (two approve clicks, an
  // approve racing a candidate decline, etc.) actually applies; the second
  // sees count 0 and knows to report a conflict instead of silently
  // re-approving/re-declining an offer that already moved on.
  updateIfStatus: (id, expectedStatus, data) => prisma.offer.updateMany({ where: { id, status: expectedStatus }, data }),
  countAccepted: (vacancyId) => prisma.offer.count({
    where: { status: 'Accepted', application: { vacancyId } }
  }),
  // Backs the Manager/Director Approvals Center - every offer a Principal
  // HR Officer has recommended but that hasn't yet been approved (or
  // declined by the candidate, which never applies at this status).
  // Oldest-recommended-first, so the longest-waiting offer surfaces at the
  // top of the queue rather than the most recent. Paginated - an unbounded
  // query here scaled linearly with the pending-approval backlog.
  findManyPendingApproval: ({ skip, take } = {}) => prisma.offer.findMany({
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
    orderBy: { recommendedDate: 'asc' },
    skip, take
  }),
  countPendingApproval: () => prisma.offer.count({ where: { status: 'Recommended' } }),
  // Offers on a vacancy that are still in play (Recommended or Approved),
  // other than excludeOfferId - used to flag offers that can no longer be
  // accepted once the vacancy is Filled.
  findOpenForVacancy: (vacancyId, excludeOfferId) => prisma.offer.findMany({
    where: {
      status: { in: ['Recommended', 'Approved'] },
      application: { vacancyId },
      ...(excludeOfferId ? { id: { not: excludeOfferId } } : {})
    },
    include: { application: { include: { candidate: { select: { fullName: true } } } } },
    orderBy: { id: 'asc' }
  })
};
