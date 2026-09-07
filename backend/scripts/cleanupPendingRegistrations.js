// Run on a schedule (e.g. hourly via cron), not as an in-process timer -
// same convention as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/cleanupPendingRegistrations.js
//
// A PendingCandidateRegistration only exists to hold a signup until its
// confirmation link is used - confirmEmail() deletes it the moment that
// happens. This script handles the other half of that lifecycle: a link
// that expires unused. Deleting the registration cascades (onDelete:
// Cascade on VerificationToken.pendingRegistration) to its token(s) too,
// so nothing orphaned is left behind either way.
const prisma = require('../src/config/db');

async function main() {
  const now = new Date();

  const pending = await prisma.pendingCandidateRegistration.findMany({
    include: { verificationTokens: true }
  });

  let removed = 0;
  for (const registration of pending) {
    const hasLiveToken = registration.verificationTokens.some(
      (t) => t.type === 'EmailConfirmation' && !t.usedAt && t.expiresAt > now
    );
    if (hasLiveToken) continue; // confirmation window still open - leave it alone

    await prisma.pendingCandidateRegistration.delete({ where: { id: registration.id } });
    removed++;
  }

  console.log(`Pending registration cleanup complete. ${removed} expired, unconfirmed registration(s) removed.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
