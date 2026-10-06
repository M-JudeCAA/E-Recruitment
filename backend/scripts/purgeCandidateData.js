// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same convention as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/purgeCandidateData.js
//
// Retention (FR-ATS-079): an unsuccessful candidate's personal data is kept
// for the "candidateRetentionMonths" setting (Settings page; default 24)
// after their last activity, then erased (services/candidatePurgeService.js)
// and logged in DataPurgeLog. Hired candidates and anyone with an
// application still in progress are never touched.
require('dotenv').config();
const purge = require('../src/services/candidatePurgeService');

async function run(now = new Date()) {
  const { purged, months } = await purge.purgeExpired(now);
  return `Candidate data purge complete. ${purged} candidate(s) inactive for more than ${months} months erased.`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('purgeCandidateData', run);
}
