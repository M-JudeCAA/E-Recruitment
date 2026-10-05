// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same convention as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/purgeAccessLog.js
//
// Retention for the access log (FR-ATS-079/081): DataAccessLog rows record
// who viewed candidate data (services/accessLogService.js). They are kept
// for the "accessLogRetentionDays" setting (Settings page; falls back to
// ACCESS_LOG_RETENTION_DAYS, default two years) and then deleted - the
// record of a view is personal data too, and isn't kept for ever.
require('dotenv').config();
const prisma = require('../src/config/db');
const settings = require('../src/services/settingsService');

const DEFAULT_RETENTION_DAYS = 730;
// A mistyped setting (say "3" meant as years) must not wipe the log.
const MIN_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function retentionDays(env = process.env) {
  const raw = env.ACCESS_LOG_RETENTION_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS) {
    throw new Error(`ACCESS_LOG_RETENTION_DAYS must be a whole number of days, at least ${MIN_RETENTION_DAYS} (got "${raw}")`);
  }
  return days;
}

async function run(now = new Date()) {
  // The setting wins once someone has set it; until then the environment.
  const set = await prisma.setting.findUnique({ where: { key: 'accessLogRetentionDays' } });
  const days = set ? await settings.get('accessLogRetentionDays') : retentionDays();
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const { count } = await prisma.dataAccessLog.deleteMany({ where: { at: { lt: cutoff } } });
  return `Access log purge complete. ${count} record(s) older than ${days} days removed.`;
}

module.exports = { run, retentionDays, DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('purgeAccessLog', run);
}
