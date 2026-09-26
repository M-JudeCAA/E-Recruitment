const prisma = require('../config/db');

module.exports = {
  findByEmail: (email) => prisma.candidate.findUnique({ where: { email } }),
  // nationalId is @unique (schema.prisma) - used to give a clear,
  // immediate error at registration time rather than letting a duplicate
  // only surface later as a raw constraint violation.
  findByNationalId: (nationalId) => prisma.candidate.findUnique({ where: { nationalId } }),
  findById: (id, include) => prisma.candidate.findUnique({ where: { id }, include }),
  create: (data) => prisma.candidate.create({ data }),
  update: (id, data) => prisma.candidate.update({ where: { id }, data }),
  // internalProfile is included alongside education/workExperience so this
  // one query can back isProfileComplete() (which needs all three) as well
  // as screening - not just the two fields screening itself reads.
  // examGrades added for screeningService.evaluateExamGrades - dateOfBirth/
  // flyingHours need no include, they're plain scalars on Candidate itself.
  findByIdWithRecords: (id) => prisma.candidate.findUnique({
    where: { id },
    include: { education: true, workExperience: true, internalProfile: true, examGrades: true }
  }),
  // Mirrors applicationModel.findOwnedByCandidate's role in
  // fileController.serve - lets a candidate be authorized to view their
  // own profile photo, which (unlike a cvUrl/coverLetterUrl) isn't
  // attached to any Application row.
  findOwnedByCandidate: (candidateId, url) => prisma.candidate.findFirst({ where: { id: candidateId, photoUrl: url } })
};
