const crypto = require('crypto');
const { AsyncLocalStorage, AsyncResource } = require('async_hooks');

// Who is making the current request and from where - captured once per
// request (requestContext middleware, app.js) and stamped on every audit
// row written while it runs (config/db.js extends auditLog.create), however
// the row is written. Also what the activity log (activityLogService)
// records for each change.
//
// Never the request body or query string: passwords, ID tokens and the
// ?token= on file downloads stay out. Secret tokens in a path (a committee
// member's link, a confirmation link) are masked.

const storage = new AsyncLocalStorage();

// The address the request came from. Behind the proxy, req.ip honours
// TRUST_PROXY (app.js); an IPv4 address mapped into IPv6 is shown plain.
function clientIp(req) {
  return String(req?.ip || req?.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64) || null;
}

function userAgent(req) {
  return String(req?.get?.('user-agent') || '').slice(0, 500) || null;
}

// A path segment that is a secret, not an id: long tokens (hex, base64url,
// uuids). Numeric ids and short names are kept.
const SECRET_SEGMENT = /^(?=.*[a-z])[A-Za-z0-9_-]{24,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request path with no query string and secret segments masked. */
function safePath(req) {
  const path = String(req?.originalUrl || req?.url || '').split('?')[0];
  return path.split('/').map((seg) => (SECRET_SEGMENT.test(seg) ? ':token' : seg)).join('/').slice(0, 500);
}

/** The route's pattern once Express matched it: "/api/vacancies/:id/approve". */
function routePattern(req) {
  if (!req?.route) return null;
  return `${req.baseUrl || ''}${req.route.path === '/' ? '' : req.route.path}`.slice(0, 300) || null;
}

/**
 * Who acted: { actorType, staffUserId?, candidateId?, actorLabel?, actingAsId? }.
 * A sign-in sets res.locals.auditActor (it has no session yet); a
 * shortlisting committee member is known by their link (req.committeeMember).
 */
function actorOf(req, res) {
  const signedIn = res?.locals?.auditActor;
  if (signedIn) return signedIn;
  const user = req?.user;
  if (user?.type === 'staff') {
    return { actorType: 'staff', staffUserId: user.id, actorLabel: user.name || null, actingAsId: req.actingAsDelegateFor || null };
  }
  if (user?.type === 'candidate') return { actorType: 'candidate', candidateId: user.id, actorLabel: user.email || null };
  if (req?.committeeMember) {
    const m = req.committeeMember;
    return { actorType: 'committee', actorLabel: [m.name, m.email && `<${m.email}>`].filter(Boolean).join(' ') || null };
  }
  return { actorType: 'anonymous' };
}

function middleware(req, res, next) {
  const ctx = { requestId: crypto.randomUUID(), req, res, startedAt: Date.now() };
  req.requestContext = ctx;
  res.setHeader('X-Request-Id', ctx.requestId);
  storage.run(ctx, next);
}

function current() {
  return storage.getStore() || null;
}

/**
 * The request fields of an AuditLog row, from the current request - or
 * { actorType: 'system' } outside one (a scheduled job, a script).
 */
function auditFields() {
  const ctx = current();
  if (!ctx) return { actorType: 'system' };
  const actor = actorOf(ctx.req, ctx.res);
  return {
    actorType: actor.actorType,
    actorLabel: actor.actorLabel ? String(actor.actorLabel).slice(0, 255) : null,
    ipAddress: clientIp(ctx.req),
    userAgent: userAgent(ctx.req),
    requestMethod: ctx.req.method,
    requestPath: safePath(ctx.req),
    requestId: ctx.requestId
  };
}

// multer runs its callback from the upload stream's events, outside the
// request's async context, so everything after an upload would lose it.
// Binding `next` to the context it was called in keeps it.
function keepContext(multerInstance) {
  const wrap = (mw) => (req, res, next) => mw(req, res, AsyncResource.bind(next));
  return new Proxy(multerInstance, {
    get(target, prop) {
      const value = target[prop];
      if (['single', 'array', 'fields', 'none', 'any'].includes(prop) && typeof value === 'function') {
        return (...args) => wrap(value.apply(target, args));
      }
      return value;
    }
  });
}

module.exports = { middleware, current, auditFields, actorOf, clientIp, userAgent, safePath, routePattern, keepContext };
