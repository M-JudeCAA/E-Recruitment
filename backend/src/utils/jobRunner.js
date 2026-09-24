const systemHealthModel = require('../models/systemHealthModel');

// Runs one maintenance job and records the outcome in SystemHealth
// ("job:<name>"), so a job that stops running - or keeps failing - shows up
// as a warning to staff instead of failing silently. Used both by the
// scheduler worker (scripts/scheduler.js) and by each script when it is run
// directly (from cron / Task Scheduler), so either way of scheduling counts.
// Never throws: a failing job must not take the scheduler down with it.
async function runJob(name, fn) {
  const startedAt = new Date();
  try {
    const summary = await fn();
    await recordSafely(() => systemHealthModel.recordSuccess(`job:${name}`, new Date()));
    console.log(`[${startedAt.toISOString()}] ${name}: ${summary || 'done'}`);
    return { ok: true, summary };
  } catch (err) {
    console.error(`[${startedAt.toISOString()}] ${name} failed:`, err);
    await recordSafely(() => systemHealthModel.recordFailure(`job:${name}`, err?.message || err, new Date()));
    return { ok: false, error: err };
  }
}

// Recording health must never mask the job's own outcome (e.g. when the
// database itself is what's down).
async function recordSafely(write) {
  try {
    await write();
  } catch (err) {
    console.error('Could not record job health:', err.message);
  }
}

// For `node scripts/<name>.js`: run once, disconnect, set the exit code.
async function runAsScript(name, fn) {
  const prisma = require('../config/db');
  const result = await runJob(name, fn);
  await prisma.$disconnect();
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = { runJob, runAsScript };
