const prisma = require('../config/db');
const { actorOf, clientIp, userAgent, safePath, routePattern } = require('../utils/requestContext');
const { actionFor, skipped } = require('../utils/activityActions');

// The activity log: one row for every change anyone asks the system for -
// each POST/PUT/PATCH/DELETE to the API, sign-in attempts included - with
// who (or, for a failed sign-in, the email tried), when, from which address
// and browser, what it was, and how it ended: success (2xx/3xx), refused
// (4xx - not allowed, invalid, a conflict) or failed (5xx). Written when the
// response has gone, so it records the outcome and never delays the answer.
// Never throws.
//
// Not request bodies, not query strings (utils/requestContext.js); not the
// scheduler's signals to the API, reading notifications or draft auto-saves
// (utils/activityActions.js SKIPPED).

const CHANGE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SIGN_IN_ROUTE = /\/auth\/(login|entra|register|forgot-password|reset-password)$/;

function outcomeOf(status) {
  if (status < 400) return 'success';
  if (status < 500) return 'refused';
  return 'failed';
}

// The ids the request acted on (route parameters), never a link's secret
// token; for a sign-in or registration, the email it was for.
function detailOf(req, res, route) {
  const detail = {};
  for (const [key, value] of Object.entries(req.params || {})) {
    if (key !== 'token' && value !== undefined) detail[key] = String(value).slice(0, 100);
  }
  if (route && SIGN_IN_ROUTE.test(route)) {
    const email = res.locals?.attemptedEmail || (typeof req.body?.email === 'string' ? req.body.email : null);
    if (email) detail.email = email.trim().toLowerCase().slice(0, 255);
  }
  return Object.keys(detail).length ? detail : null;
}

async function record(req, res) {
  try {
    const route = routePattern(req);
    if (route && skipped(req.method, route)) return;
    const actor = actorOf(req, res);
    const ctx = req.requestContext;
    await prisma.activityLog.create({
      data: {
        requestId: ctx?.requestId || null,
        actorType: actor.actorType,
        staffUserId: actor.staffUserId || null,
        candidateId: actor.candidateId || null,
        actingAsId: actor.actingAsId || null,
        actorLabel: actor.actorLabel ? String(actor.actorLabel).slice(0, 255) : null,
        method: req.method,
        path: safePath(req),
        route,
        action: route ? actionFor(req.method, route) : `${req.method} request (no such route)`,
        statusCode: res.statusCode,
        outcome: outcomeOf(res.statusCode),
        durationMs: ctx?.startedAt ? Date.now() - ctx.startedAt : null,
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
        detail: detailOf(req, res, route) || undefined
      }
    });
  } catch (err) {
    console.error(`Failed to write the activity log (${req.method} ${safePath(req)}):`, err);
  }
}

// Express middleware: records each change request once it has finished.
function middleware(req, res, next) {
  const url = req.originalUrl || '';
  if (CHANGE_METHODS.has(req.method) && url.startsWith('/api/') && !url.startsWith('/api/internal/')) {
    res.on('finish', () => { record(req, res); });
  }
  next();
}

module.exports = { middleware, record, outcomeOf, detailOf };
