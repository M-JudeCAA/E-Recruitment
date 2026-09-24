// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same convention as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/cleanupVerificationTokens.js
//
// Email-confirmation and password-reset tokens (VerificationToken) are
// single-use and short-lived: tokenService refuses any token that is used
// or expired, so old rows are dead weight - never a way back in. This
// deletes them once they have been dead for RETENTION_DAYS, keeping a week
// of recent history for anyone investigating a "my link didn't work"
// report. Tokens that still belong to an unconfirmed registration are left
// to cleanupPendingRegistrations.js, which deletes the registration and its
// tokens together.
// Loads SMTP_* etc. from backend/.env when run directly. Prisma reads
// DATABASE_URL from .env on its own, but the mailer does not - without
// this, emails sent from a cron-run script always failed.
require('dotenv').config();
const prisma = require('../src/config/db');

const RETENTION_DAYS = 7;

async function run(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.verificationToken.deleteMany({
    where: {
      pendingRegistrationId: null,
      OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }]
    }
  });
  return `Verification token cleanup complete. ${count} used or expired token(s) removed.`;
}

module.exports = { run, RETENTION_DAYS };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('cleanupVerificationTokens', run);
}
