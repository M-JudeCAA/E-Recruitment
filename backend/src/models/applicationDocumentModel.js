const prisma = require('../config/db');

// Supporting documents attached to an application (academic documents and
// anything else relevant) - see ApplicationDocument in schema.prisma.
module.exports = {
  create: (data) => prisma.applicationDocument.create({ data }),
  findById: (id) => prisma.applicationDocument.findUnique({ where: { id } }),
  findByApplication: (applicationId) => prisma.applicationDocument.findMany({
    where: { applicationId }, orderBy: { uploadedAt: 'asc' }
  }),
  countByApplication: (applicationId, category) => prisma.applicationDocument.count({
    where: { applicationId, ...(category ? { category } : {}) }
  }),
  remove: (id) => prisma.applicationDocument.delete({ where: { id } })
};
