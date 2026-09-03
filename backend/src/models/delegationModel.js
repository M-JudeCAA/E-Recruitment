const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.delegation.create({ data }),
  findById: (id) => prisma.delegation.findUnique({ where: { id } }),

  findAll: () => prisma.delegation.findMany({
    include: {
      delegator: { select: { id: true, name: true, role: true } },
      delegate: { select: { id: true, name: true, role: true } },
      authorizedBy: { select: { id: true, name: true, role: true } }
    },
    orderBy: { createdAt: 'desc' }
  }),

  findAllByDelegator: (delegatorId) => prisma.delegation.findMany({
    where: { delegatorId },
    include: {
      delegator: { select: { id: true, name: true, role: true } },
      delegate: { select: { id: true, name: true, role: true } },
      authorizedBy: { select: { id: true, name: true, role: true } }
    },
    orderBy: { createdAt: 'desc' }
  }),

  // The single query the delegation-aware permission check depends on:
  // is there a delegation, right now, where this user is the delegate?
  // now must be passed in explicitly (not defaulted inside the query)
  // so this function stays trivially testable with a fixed clock.
  findActiveForDelegate: (delegateId, now) => prisma.delegation.findFirst({
    where: { delegateId, startDate: { lte: now }, endDate: { gte: now } },
    include: { delegator: true }
  }),

  logUsage: (delegationId, action) => prisma.delegationUsage.create({
    data: { delegationId, action }
  })
};
