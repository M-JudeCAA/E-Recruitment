// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same convention as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/retryHrisHandoffs.js
//
// Sends onboarding cases (Mark as Hired, FR-ATS-068) the HRIS hasn't taken
// yet: any still Pending whose wait since the last attempt has passed
// (services/hrisHandoffService.js). With no HRIS_HANDOFF_URL there is
// nothing to send.
require('dotenv').config();
const prisma = require('../src/config/db');
const handoff = require('../src/services/hrisHandoffService');

async function run(now = new Date()) {
  if (!handoff.configured()) return 'No HRIS connection set up (HRIS_HANDOFF_URL) - nothing to send.';
  const pending = await prisma.hire.findMany({ where: { handoffStatus: 'Pending' }, orderBy: { id: 'asc' } });
  const due = pending.filter((h) => handoff.dueForRetry(h, now));
  let sent = 0;
  let failed = 0;
  for (const h of due) {
    const result = await handoff.send(h.id);
    if (result?.handoffStatus === 'Sent') sent += 1;
    else if (result?.handoffStatus === 'Failed') failed += 1;
  }
  return `HRIS handoff: ${due.length} case(s) due, ${sent} sent, ${failed} given up on, ${pending.length - due.length} waiting to retry.`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('retryHrisHandoffs', run);
}
