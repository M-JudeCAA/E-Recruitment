const prisma = require('../config/db');

// Evidence that a vacancy was advertised (VacancyAdvertEvidence) - see
// vacancyController.close and addAdvertEvidence.
module.exports = {
  countByVacancy: (vacancyId) => prisma.vacancyAdvertEvidence.count({ where: { vacancyId } }),
  createMany: (vacancyId, files, note, uploadedById) => prisma.vacancyAdvertEvidence.createMany({
    data: files.map((f) => ({ vacancyId, fileUrl: f.fileUrl, originalName: f.originalName, note, uploadedById }))
  })
};
