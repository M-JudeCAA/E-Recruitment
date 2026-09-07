const prisma = require('../config/db');

module.exports = {
  create: (data) => prisma.pendingCandidateRegistration.create({ data }),
  findByEmail: (email) => prisma.pendingCandidateRegistration.findUnique({ where: { email } }),
  findById: (id) => prisma.pendingCandidateRegistration.findUnique({ where: { id } }),
  // onDelete: Cascade on VerificationToken.pendingRegistration takes any
  // token(s) for this row with it - no separate cleanup needed here.
  remove: (id) => prisma.pendingCandidateRegistration.delete({ where: { id } }),
  // Whether this pending registration still has a live (unused,
  // unexpired) confirmation link outstanding - used by register() to
  // decide whether a re-registration attempt should be refused (link
  // still valid, resending would just create a second live token) or
  // allowed to replace an abandoned one.
  hasLiveToken: async (pendingRegistrationId) => {
    const token = await prisma.verificationToken.findFirst({
      where: {
        pendingRegistrationId, type: 'EmailConfirmation',
        usedAt: null, expiresAt: { gt: new Date() }
      }
    });
    return !!token;
  }
};
