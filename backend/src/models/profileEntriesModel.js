const prisma = require('../config/db');

module.exports = {
  createWorkExperience: (data) => prisma.workExperience.create({ data }),
  createEducation: (data) => prisma.education.create({ data }),
  // Scoped to candidateId (same pattern as candidateNotificationModel.markRead)
  // so one candidate can't edit or delete another's entry by guessing an id.
  updateEducation: (id, candidateId, data) => prisma.education.updateMany({ where: { id, candidateId }, data }),
  deleteEducation: (id, candidateId) => prisma.education.deleteMany({ where: { id, candidateId } }),
  updateWorkExperience: (id, candidateId, data) => prisma.workExperience.updateMany({ where: { id, candidateId }, data }),
  deleteWorkExperience: (id, candidateId) => prisma.workExperience.deleteMany({ where: { id, candidateId } })
};
