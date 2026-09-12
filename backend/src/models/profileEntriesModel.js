const prisma = require('../config/db');

module.exports = {
  createWorkExperience: (data) => prisma.workExperience.create({ data }),
  createEducation: (data) => prisma.education.create({ data }),
  createCertificate: (data) => prisma.certificate.create({ data }),
  // Read back before a create/update so the controller can dedupe against
  // what's already on file (see entryDedup.js) - small, unpaginated lists
  // scoped to one candidate, so a plain findMany is fine here.
  findEducationForCandidate: (candidateId) => prisma.education.findMany({ where: { candidateId } }),
  findWorkExperienceForCandidate: (candidateId) => prisma.workExperience.findMany({ where: { candidateId } }),
  findCertificatesForCandidate: (candidateId) => prisma.certificate.findMany({ where: { candidateId } }),
  // Scoped to candidateId (same pattern as candidateNotificationModel.markRead)
  // so one candidate can't edit or delete another's entry by guessing an id.
  updateEducation: (id, candidateId, data) => prisma.education.updateMany({ where: { id, candidateId }, data }),
  deleteEducation: (id, candidateId) => prisma.education.deleteMany({ where: { id, candidateId } }),
  updateWorkExperience: (id, candidateId, data) => prisma.workExperience.updateMany({ where: { id, candidateId }, data }),
  deleteWorkExperience: (id, candidateId) => prisma.workExperience.deleteMany({ where: { id, candidateId } }),
  updateCertificate: (id, candidateId, data) => prisma.certificate.updateMany({ where: { id, candidateId }, data }),
  deleteCertificate: (id, candidateId) => prisma.certificate.deleteMany({ where: { id, candidateId } })
};
