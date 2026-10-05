const prisma = require('../config/db');

// FR-ATS-037: possible duplicate applications - the same person applying to
// one vacancy from two accounts. Email and NIN are unique per account, so
// the tell-tale is a shared phone number (Candidate.phoneKey). Each
// application in a staff list gets possibleDuplicates: the other
// applications on its vacancy from a different account with the same
// phone, for HR to resolve (one is usually withdrawn or rejected). A shared
// phone isn't proof - a family can share one - so it is a flag, not a block.

async function annotate(applications) {
  const keyed = applications.filter((a) => a.candidate?.phoneKey);
  if (keyed.length === 0) return applications.map((a) => ({ ...a, possibleDuplicates: [] }));

  const matches = await prisma.application.findMany({
    where: {
      vacancyId: { in: [...new Set(keyed.map((a) => a.vacancyId))] },
      status: { not: 'Draft' },
      candidate: { phoneKey: { in: [...new Set(keyed.map((a) => a.candidate.phoneKey))] } }
    },
    select: { id: true, vacancyId: true, candidateId: true, candidate: { select: { fullName: true, phoneKey: true } } }
  });

  return applications.map((a) => ({
    ...a,
    possibleDuplicates: a.candidate?.phoneKey
      ? matches
        .filter((m) => m.vacancyId === a.vacancyId && m.candidateId !== a.candidateId && m.candidate.phoneKey === a.candidate.phoneKey)
        .map((m) => ({ applicationId: m.id, candidateName: m.candidate.fullName, reason: 'Same phone number' }))
      : []
  }));
}

module.exports = { annotate };
