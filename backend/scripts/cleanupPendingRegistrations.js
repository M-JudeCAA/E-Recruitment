// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same convention as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/cleanupPendingRegistrations.js
//
// A PendingCandidateRegistration only exists to hold a signup until its
// confirmation link is used - confirmEmail() deletes it the moment that
// happens. This script handles the other half of that lifecycle: a link
// that expires unused. Deleting the registration cascades (onDelete:
// Cascade on VerificationToken.pendingRegistration) to its token(s) too,
// so nothing orphaned is left behind either way.
// Loads SMTP_* etc. from backend/.env when run directly. Prisma reads
// DATABASE_URL from .env on its own, but the mailer does not - without
// this, emails sent from a cron-run script always failed.
require('dotenv').config();
const prisma = require('../src/config/db');

async function run() {
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

  return `Pending registration cleanup complete. ${removed} expired, unconfirmed registration(s) removed.`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('cleanupPendingRegistrations', run);
}
