const prisma = require('../config/db');

// Prisma's upsert is a read-then-write, not atomic: when several requests
// write the same key for the first time at once (a burst of emails right
// after start-up), all but one "create" hits the primary key and fails with
// P2002. By then the row exists, so one retry takes the update path. Found by
// the e2e concurrency tests.
async function upsert(args) {
  try {
    return await prisma.systemHealth.upsert(args);
  } catch (err) {
    if (err?.code !== 'P2002') throw err;
    return prisma.systemHealth.upsert(args);
  }
}

// See the SystemHealth model in schema.prisma. Keys are "mail" and
// "job:<scriptName>". Every write is an upsert, so a key needs no setup.
module.exports = {
  findAll: () => prisma.systemHealth.findMany(),
  recordSuccess: (key, at = new Date()) => upsert({
    where: { key },
    // alertedAt cleared on recovery, so the NEXT outage alerts straight away
    // instead of waiting out the previous outage's 24h alert window.
    create: { key, lastSuccessAt: at },
    update: { lastSuccessAt: at, consecutiveFailures: 0, alertedAt: null }
  }),
  recordFailure: (key, error, at = new Date()) => upsert({
    where: { key },
    create: { key, lastFailureAt: at, lastError: String(error).slice(0, 2000), consecutiveFailures: 1 },
    update: { lastFailureAt: at, lastError: String(error).slice(0, 2000), consecutiveFailures: { increment: 1 } }
  }),
  ensureExists: (key) => upsert({ where: { key }, create: { key }, update: {} }),
  // Atomic "claim the right to alert": only succeeds (count 1) when nobody
  // has alerted for this key within the window, so two processes noticing
  // the same outage at once can't both send the alert.
  claimAlert: (key, now, windowMs) => prisma.systemHealth.updateMany({
    where: { key, OR: [{ alertedAt: null }, { alertedAt: { lt: new Date(now.getTime() - windowMs) } }] },
    data: { alertedAt: now }
  })
};
