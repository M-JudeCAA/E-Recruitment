const crypto = require('crypto');

// The maintenance jobs run in the scheduler worker, a process of its own, so
// what they change (an offer expired and a reserve promoted, a candidate's
// data erased, a handoff sent) can't reach the HR dashboards through
// broadcastDashboardEvent - that only knows the sockets of the process it
// runs in. The worker instead tells the API "something changed" over HTTP
// (POST /api/internal/dashboard-events) and the API broadcasts it.
//
// Like the socket itself this carries a signal, never data. The request is
// signed with JWT_SECRET (an HMAC over a timestamp and the body, good for a
// minute) rather than sent with a token: nothing here can be used as a
// session, and the API accepts it only from a process that shares its secret.

const MAX_AGE_MS = 60 * 1000;
const TIMEOUT_MS = 3000;

function sign(timestamp, event, payload) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`dashboard-signal:${timestamp}:${event}:${JSON.stringify(payload || {})}`)
    .digest('hex');
}

const apiUrl = () => (process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 4000}`).replace(/\/$/, '');

/**
 * Asks the API to tell connected dashboards to refetch. Never throws and
 * never waits long: the API being down must not fail or stall a job.
 * Returns whether the API took it.
 */
async function signalDashboards(event, payload = {}) {
  if (!process.env.JWT_SECRET) return false;
  try {
    const timestamp = String(Date.now());
    const response = await fetch(`${apiUrl()}/api/internal/dashboard-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signal-Timestamp': timestamp,
        'X-Signal-Signature': sign(timestamp, event, payload)
      },
      body: JSON.stringify({ event, payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return response.ok;
  } catch (err) {
    return false;
  }
}

/** Whether a request to the internal endpoint carries a fresh, valid signature. */
function verifySignal(req, now = Date.now()) {
  if (!process.env.JWT_SECRET) return false;
  const timestamp = String(req.headers['x-signal-timestamp'] || '');
  const given = String(req.headers['x-signal-signature'] || '');
  const event = req.body?.event;
  if (!/^\d+$/.test(timestamp) || typeof event !== 'string' || !event) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_MS) return false;
  const expected = sign(timestamp, event, req.body.payload);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

module.exports = { signalDashboards, verifySignal, sign };
