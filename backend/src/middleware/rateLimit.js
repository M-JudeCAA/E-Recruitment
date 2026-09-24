// Fixed-window rate limiting for the sign-in, registration and
// password-reset endpoints, so they can't be used to guess passwords or to
// flood someone's inbox with confirmation/reset emails.
//
// In-memory and per process: counts reset if the API restarts, and each
// API process keeps its own counts. That is enough for the single-process
// deployment described in SETUP.md; a multi-process deployment would need a
// shared store (e.g. Redis) instead.
//
// The per-address limit relies on req.ip, which is only the real client
// address if Express trusts the reverse proxy in front of it - see
// TRUST_PROXY in app.js. The per-account limit (keyed on the submitted
// email) is the main defence against guessing one account's password, and
// works whatever the proxy setup.

function createRateLimiter({ name, windowMs, max, keyFrom, now = () => Date.now() }) {
  const hits = new Map(); // key -> { count, resetAt }

  function prune(t) {
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }

  const middleware = (req, res, next) => {
    const key = keyFrom(req);
    if (!key) return next(); // e.g. no email submitted - the controller rejects it anyway

    const t = now();
    if (hits.size > 10000) prune(t);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - t) / 1000);
      const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      console.warn(`Rate limit hit: ${name} (${key.startsWith('ip:') ? key : 'account'})`);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`
      });
    }
    return next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

const byIp = (req) => `ip:${req.ip}`;
// Normalised so "A@x.com" and " a@x.com" share one budget.
const byEmail = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email ? `email:${email}` : null;
};

const MINUTE = 60 * 1000;

// Generous per-address limits, since many UCAA staff share one office
// network address; tight per-account limits, since that is what stops a
// password being guessed.
function authLimiters(scope) {
  return {
    login: [
      createRateLimiter({ name: `${scope} login per address`, windowMs: 15 * MINUTE, max: 100, keyFrom: byIp }),
      createRateLimiter({ name: `${scope} login per account`, windowMs: 15 * MINUTE, max: 10, keyFrom: byEmail })
    ],
    forgotPassword: [
      createRateLimiter({ name: `${scope} password reset per address`, windowMs: 60 * MINUTE, max: 20, keyFrom: byIp }),
      createRateLimiter({ name: `${scope} password reset per account`, windowMs: 60 * MINUTE, max: 5, keyFrom: byEmail })
    ],
    register: [
      createRateLimiter({ name: `${scope} registration per address`, windowMs: 60 * MINUTE, max: 20, keyFrom: byIp }),
      createRateLimiter({ name: `${scope} registration per account`, windowMs: 60 * MINUTE, max: 5, keyFrom: byEmail })
    ]
  };
}

module.exports = { createRateLimiter, authLimiters, byIp, byEmail };
