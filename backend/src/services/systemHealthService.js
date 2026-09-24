// Turns the SystemHealth rows into something staff can act on: a list of
// plain-language warnings for the banner on the HR home page
// (GET /api/dashboard/system-health), plus a once-a-day in-app alert to
// every Director while a problem lasts. Two things are watched, both of
// which used to fail without anyone noticing:
//   - the scheduled maintenance jobs (they only run if the scheduler worker
//     or cron is set up - see scripts/scheduler.js and SETUP.md), and
//   - outgoing email (utils/mailer.js records every attempt).
const systemHealthModel = require('../models/systemHealthModel');
const notificationModel = require('../models/notificationModel');
const prisma = require('../config/db');

// Every job the scheduler runs. Each is expected hourly, so one missed run
// is tolerated and a job counts as stale after STALE_AFTER_HOURS.
const JOBS = [
  { name: 'checkSlaEscalations', label: 'SLA escalation check' },
  { name: 'checkVacancyDeadlines', label: 'vacancy deadline notices' },
  { name: 'cleanupPendingRegistrations', label: 'cleanup of abandoned registrations' },
  { name: 'cleanupVerificationTokens', label: 'cleanup of old confirmation and reset links' }
];
const STALE_AFTER_HOURS = 3;
// A single failed email shows on the banner straight away (it is the
// current state), but Directors are only alerted once failures repeat, so
// a one-off blip doesn't page anyone.
const MAIL_ALERT_AFTER_FAILURES = 3;
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatTime(date) {
  return date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null;
}

// Pure: rows in, status out. lastError is deliberately NOT included in the
// result - SMTP and database errors carry host names and similar internals
// (see utils/errorResponse.js); they stay in the server log and the
// SystemHealth table for whoever administers the server.
function buildStatus(rows, now = new Date()) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const staleBefore = new Date(now.getTime() - STALE_AFTER_HOURS * 60 * 60 * 1000);
  const warnings = [];

  const jobs = JOBS.map(({ name, label }) => {
    const row = byKey.get(`job:${name}`);
    let status = 'ok';
    if (!row || !row.lastSuccessAt) status = row?.lastFailureAt ? 'failing' : 'never';
    else if (row.consecutiveFailures > 0) status = 'failing';
    else if (row.lastSuccessAt < staleBefore) status = 'stale';
    return {
      name, label, status,
      lastSuccessAt: row?.lastSuccessAt || null,
      lastFailureAt: row?.lastFailureAt || null
    };
  });

  const notRunning = jobs.filter((j) => j.status === 'never' || j.status === 'stale');
  const failing = jobs.filter((j) => j.status === 'failing');
  if (notRunning.length) {
    warnings.push(
      `Scheduled maintenance has not run in the last ${STALE_AFTER_HOURS} hours (${notRunning.map((j) => j.label).join(', ')}). `
      + 'SLA escalations and deadline notices are not being sent. Start the scheduler worker (npm run jobs) - see SETUP.md.'
    );
  }
  if (failing.length) {
    warnings.push(
      `Scheduled maintenance is failing (${failing.map((j) => j.label).join(', ')}). Details are in the server log.`
    );
  }

  const mailRow = byKey.get('mail');
  let mailStatus = 'unknown';
  if (mailRow) mailStatus = mailRow.consecutiveFailures > 0 ? 'failing' : 'ok';
  if (mailStatus === 'failing') {
    warnings.push(
      `Emails are not being sent. The last ${mailRow.consecutiveFailures} attempt${mailRow.consecutiveFailures === 1 ? '' : 's'} failed, `
      + `most recently at ${formatTime(mailRow.lastFailureAt)}. Candidates and staff are not receiving email notifications. `
      + 'Check the SMTP settings; details are in the server log.'
    );
  }

  return {
    jobs,
    mail: {
      status: mailStatus,
      consecutiveFailures: mailRow?.consecutiveFailures || 0,
      lastSuccessAt: mailRow?.lastSuccessAt || null,
      lastFailureAt: mailRow?.lastFailureAt || null
    },
    warnings,
    checkedAt: now
  };
}

async function getStatus(now = new Date()) {
  return buildStatus(await systemHealthModel.findAll(), now);
}

// In-app only (never email - email may be exactly what is broken), to every
// Director, at most once per key per 24h while the problem lasts.
async function alertDirectors(key, message, now) {
  const claimed = await systemHealthModel.claimAlert(key, now, ALERT_WINDOW_MS);
  if (claimed.count === 0) return false;
  const directors = await prisma.staffUser.findMany({ where: { role: 'Director' }, select: { id: true } });
  await Promise.all(directors.map((d) => notificationModel.create({
    recipientId: d.id, channel: 'InApp', taskType: 'SystemHealthAlert', taskId: 0, message
  })));
  return true;
}

// Called lazily - from the scheduler after each cycle, after a failed email,
// and whenever a staff member's HR home page loads the banner - rather than
// from a timer inside the API process (this project keeps scheduled work out
// of the request-serving process; see scripts/scheduler.js). The page-load
// path matters: if the scheduler itself is dead, nothing else would notice.
async function checkAndAlert(now = new Date()) {
  const rows = await systemHealthModel.findAll();
  const status = buildStatus(rows, now);

  const mailRow = rows.find((r) => r.key === 'mail');
  if (mailRow && mailRow.consecutiveFailures >= MAIL_ALERT_AFTER_FAILURES) {
    await alertDirectors('mail', status.warnings.find((w) => w.startsWith('Emails are not being sent')), now);
  }
  for (const job of status.jobs) {
    if (job.status === 'ok') continue;
    const message = job.status === 'failing'
      ? `The scheduled job "${job.label}" is failing. Details are in the server log.`
      : `The scheduled job "${job.label}" has not run in the last ${STALE_AFTER_HOURS} hours. Start the scheduler worker (npm run jobs) - see SETUP.md.`;
    // A job that has never run has no row yet - create one so the alert
    // window can be claimed and the alert isn't repeated on every page load.
    if (!rows.some((r) => r.key === `job:${job.name}`)) {
      await systemHealthModel.ensureExists(`job:${job.name}`);
    }
    await alertDirectors(`job:${job.name}`, message, now);
  }
  return status;
}

module.exports = { JOBS, STALE_AFTER_HOURS, MAIL_ALERT_AFTER_FAILURES, buildStatus, getStatus, checkAndAlert };
