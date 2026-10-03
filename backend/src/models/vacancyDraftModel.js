const prisma = require('../config/db');

// Every query is scoped to the draft's owner - drafts are private.
const LIST_SELECT = { id: true, title: true, requisitionFilename: true, createdAt: true, updatedAt: true };

module.exports = {
  listMine: (createdById) => prisma.vacancyDraft.findMany({
    where: { createdById }, select: LIST_SELECT, orderBy: { updatedAt: 'desc' }
  }),
  findMine: (id, createdById) => prisma.vacancyDraft.findFirst({ where: { id, createdById } }),
  create: (data) => prisma.vacancyDraft.create({ data, select: LIST_SELECT }),
  // Only if nobody saved it since `baseUpdatedAt` (another tab, say) -
  // { count } like updateMany.
  updateIfUnchanged: (id, createdById, baseUpdatedAt, data) => prisma.vacancyDraft.updateMany({
    where: { id, createdById, updatedAt: baseUpdatedAt }, data
  }),
  removeMine: (id, createdById) => prisma.vacancyDraft.deleteMany({ where: { id, createdById } }),
  // Requisition uploads a draft still holds - kept by the cleanup job.
  requisitionFilenames: () => prisma.vacancyDraft.findMany({
    where: { requisitionFilename: { not: null } }, select: { requisitionFilename: true }
  })
};
