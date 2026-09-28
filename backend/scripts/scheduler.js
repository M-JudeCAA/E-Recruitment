// The scheduler worker: runs every maintenance job once at start-up and then
// every SCHEDULER_INTERVAL_MINUTES (default 60), in a process of its own.
//
//   npm run jobs        (node scripts/scheduler.js)
//
// Deliberately a separate, long-running process rather than a timer inside
// the API server: this project keeps scheduled work out of the
// request-serving process so it never competes with requests for the event
// loop (see the header of checkSlaEscalations.js). Run it alongside the API
// under whatever keeps the API itself running (pm2, systemd, NSSM on
// Windows) - see SETUP.md. Running the individual scripts from cron or Task
// Scheduler instead still works; use one approach or the other, not both,
// or SLA escalations could be checked twice in the same hour.
//
// Each run is recorded in SystemHealth, and after every cycle Directors are
// alerted in-app about anything stale or failing - so if this worker stops,
// the HR home page shows a warning within a few hours.
require('dotenv').config();
const prisma = require('../src/config/db');
const { runJob } = require('../src/utils/jobRunner');
const { verifyMailTransport } = require('../src/utils/mailer');
const { checkAndAlert } = require('../src/services/systemHealthService');

const JOBS = [
  { name: 'checkSlaEscalations', run: require('./checkSlaEscalations').run },
  { name: 'checkVacancyDeadlines', run: require('./checkVacancyDeadlines').run },
  { name: 'sendInterviewReminders', run: require('./sendInterviewReminders').run },
  { name: 'cleanupPendingRegistrations', run: require('./cleanupPendingRegistrations').run },
  { name: 'cleanupVerificationTokens', run: () => require('./cleanupVerificationTokens').run() }
];

const intervalMinutes = Number(process.env.SCHEDULER_INTERVAL_MINUTES || 60);
if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
  console.error('SCHEDULER_INTERVAL_MINUTES must be a number of minutes, at least 1.');
  process.exit(1);
}

let cycleInProgress = false;

// Jobs run one after another, never overlapping: if a cycle is still going
// when the next is due (a slow database), the next one is skipped.
async function runCycle() {
  if (cycleInProgress) {
    console.warn('Previous maintenance cycle still running - skipping this one.');
    return;
  }
  cycleInProgress = true;
  try {
    for (const job of JOBS) await runJob(job.name, job.run);
    await checkAndAlert();
  } catch (err) {
    console.error('Maintenance cycle error:', err);
  } finally {
    cycleInProgress = false;
  }
}

async function main() {
  console.log(`Scheduler worker started - running ${JOBS.length} jobs every ${intervalMinutes} minute(s).`);
  await verifyMailTransport();
  await runCycle();
  const timer = setInterval(runCycle, intervalMinutes * 60 * 1000);

  const shutdown = async (signal) => {
    console.log(`${signal} received - scheduler worker stopping.`);
    clearInterval(timer);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
