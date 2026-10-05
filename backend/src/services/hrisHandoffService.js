const prisma = require('../config/db');
const { notifyAllWithRole } = require('./notificationService');

// Hands an onboarding case (a Hire row, see hireService) to the core HRIS
// (FR-ATS-067/068). With HRIS_HANDOFF_URL set, the package is POSTed there
// as JSON with an Idempotency-Key of the case reference - so a retry after
// a timeout can never open a second case - and HRIS_HANDOFF_TOKEN as a
// bearer token if set. The HRIS's own case id comes back as
// `onboardingCaseId` (or `caseId`/`id`). Failures are logged on the row,
// retried by scripts/retryHrisHandoffs.js with a growing wait, and after
// MAX_ATTEMPTS the case is Failed and Directors are alerted. Without the
// URL the case stays NotConfigured: HR downloads the package and passes it
// on by hand. Never throws.

const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 15000;

const configured = () => Boolean(process.env.HRIS_HANDOFF_URL);

// Minutes to wait before attempt n+1: 5, 15, 45, 135, 405.
function retryDelayMinutes(attempts) {
  return 5 * 3 ** Math.max(0, attempts - 1);
}

function dueForRetry(hire, now = new Date()) {
  if (hire.handoffStatus !== 'Pending') return false;
  if (!hire.handoffLastAttemptAt) return true;
  return now - new Date(hire.handoffLastAttemptAt) >= retryDelayMinutes(hire.handoffAttempts) * 60000;
}

async function post(hire) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(process.env.HRIS_HANDOFF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': hire.caseRef,
        ...(process.env.HRIS_HANDOFF_TOKEN ? { Authorization: `Bearer ${process.env.HRIS_HANDOFF_TOKEN}` } : {})
      },
      body: JSON.stringify({ caseRef: hire.caseRef, ...hire.package }),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HRIS answered ${res.status}: ${text.slice(0, 300)}`);
    let body = {};
    try { body = JSON.parse(text); } catch (err) { /* an empty or non-JSON success still counts */ }
    return String(body.onboardingCaseId || body.caseId || body.id || '') || null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sends (or re-sends) one case. Returns the updated row. */
async function send(hireId) {
  const hire = await prisma.hire.findUnique({ where: { id: hireId } });
  if (!hire || hire.handoffStatus === 'Sent') return hire;
  if (!configured()) {
    return prisma.hire.update({ where: { id: hireId }, data: { handoffStatus: 'NotConfigured' } });
  }
  const attempts = hire.handoffAttempts + 1;
  const now = new Date();
  try {
    const onboardingCaseId = await post(hire);
    return await prisma.hire.update({
      where: { id: hireId },
      data: { handoffStatus: 'Sent', handoffAttempts: attempts, handoffLastAttemptAt: now, handoffSentAt: now, handoffLastError: null, onboardingCaseId }
    });
  } catch (err) {
    const message = err.name === 'AbortError' ? `No answer from the HRIS within ${TIMEOUT_MS / 1000} seconds` : err.message;
    console.error(`HRIS handoff for ${hire.caseRef} failed (attempt ${attempts}):`, message);
    const failed = attempts >= MAX_ATTEMPTS;
    const updated = await prisma.hire.update({
      where: { id: hireId },
      data: { handoffStatus: failed ? 'Failed' : 'Pending', handoffAttempts: attempts, handoffLastAttemptAt: now, handoffLastError: String(message).slice(0, 2000) }
    });
    if (failed) {
      await notifyAllWithRole('Director', 'SystemHealthAlert', hire.id,
        `Onboarding case ${hire.caseRef} could not be sent to the HRIS after ${attempts} attempts. HR can retry it from the offer, or pass the package on by hand.`)
        .catch(() => {});
    }
    return updated;
  }
}

module.exports = { send, configured, dueForRetry, retryDelayMinutes, MAX_ATTEMPTS };
