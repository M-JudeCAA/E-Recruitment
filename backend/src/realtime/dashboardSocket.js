const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { siteOf, sessionRefusal } = require('../middleware/siteStamp');

// Push-based "something changed, go refetch" channel - it carries signals,
// not data. The server sends a tiny {event, payload} message when something
// changes; every page listening re-runs its own existing REST fetch in
// response. This is deliberately NOT a data-sync layer: the REST endpoints
// stay the single source of truth, so the socket and the database can never
// disagree about what's true, and every refetch goes through the usual
// permission checks.
//
// Two entrances on the same HTTP server:
//   /ws/dashboard  staff - every HR page (services/liveUpdateService.js
//                  decides what is sent; broadcastDashboardEvent reaches all
//                  staff, sendToStaff a few)
//   /ws/candidate  candidates - only signals about their own records
//                  (sendToCandidates), plus "the job list changed"
//                  (broadcastToCandidates)
//
// Auth is a first-message handshake, not a `?token=` query param - the
// browser WebSocket API can't set an Authorization header (same underlying
// limitation as EventSource), but CLAUDE.md is explicit that the
// query-param-token pattern used for /api/files/:filename must not be
// extended to other routes. A first-message handshake keeps the JWT out of
// the URL entirely (never touches server/proxy access logs). The session is
// checked as the API checks it: an inactive staff account, a closed or
// signed-out candidate account, a session on the wrong site and External
// accounts while the public site is closed are all refused.

const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const PATHS = { '/ws/dashboard': 'staff', '/ws/candidate': 'candidate' };

let running = false;
// ws -> { kind: 'staff' | 'candidate', id }
const clients = new Map();

function refuse(ws) {
  try { ws.close(4001, 'Unauthorized'); } catch { /* already gone */ }
}

async function staffAllowed(decoded, site) {
  if (decoded.type !== 'staff') return false;
  // Behind production's nginx (REQUIRE_SITE_HEADER), only the HR site's own
  // connections (middleware/siteStamp.js); null means stamps aren't used.
  if (sessionRefusal(site, decoded)) return false;
  const staffModel = require('../models/staffModel');
  const current = await staffModel.findAuthState(decoded.id);
  return Boolean(current && current.active);
}

async function candidateAllowed(decoded, site) {
  if (decoded.type !== 'candidate') return false;
  if (site === 'staff') return false;
  const candidateModel = require('../models/candidateModel');
  const current = await candidateModel.findAuthState(decoded.id);
  if (!current || current.purgedAt) return false;
  if ((current.tokenVersion ?? 0) !== (decoded.tv ?? 0)) return false;
  if (sessionRefusal(site, decoded, current.candidateType)) return false;
  const { externalSiteOpen } = require('../config/externalSite');
  if (current.candidateType === 'External' && !externalSiteOpen()) return false;
  return true;
}

async function authenticateSocket(ws, raw, kind, site) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return refuse(ws);
  }
  if (msg.type !== 'auth' || typeof msg.token !== 'string') return refuse(ws);

  let decoded;
  try {
    decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
  } catch {
    return refuse(ws);
  }
  let allowed = false;
  try {
    allowed = kind === 'staff' ? await staffAllowed(decoded, site) : await candidateAllowed(decoded, site);
  } catch {
    allowed = false;
  }
  if (!allowed || ws.readyState !== ws.OPEN) return refuse(ws);

  ws.isAlive = true;
  clients.set(ws, { kind, id: decoded.id });
  ws.send(JSON.stringify({ type: 'auth:ok' }));
}

function init(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];
    const kind = PATHS[path];
    if (!kind) { socket.destroy(); return; }
    // Production's nginx stamps every request with its site; the staff
    // entrance answers only the HR site, the candidate one never it.
    const site = siteOf(req);
    if (site !== null && (kind === 'staff') !== (site === 'staff')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const authTimer = setTimeout(() => {
        if (!clients.has(ws)) refuse(ws); // never authenticated within the window
      }, AUTH_TIMEOUT_MS);

      // A connection only ever sends one meaningful message (the auth
      // handshake) - anything after that is ignored rather than parsed
      // again, since this channel has no other client->server traffic.
      ws.once('message', (raw) => {
        clearTimeout(authTimer);
        authenticateSocket(ws, raw, kind, site);
      });

      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    });
  });

  // Standard `ws` dead-connection sweep: a client that didn't answer the
  // previous ping (e.g. laptop closed without a clean close frame) gets
  // terminated instead of silently accumulating as a target that will
  // never actually receive anything.
  setInterval(() => {
    for (const ws of clients.keys()) {
      if (ws.isAlive === false) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS).unref();

  running = true;
  return wss;
}

function send(filter, type, event, payload) {
  if (clients.size === 0) return;
  const message = JSON.stringify({ type, event, payload: payload || {}, at: new Date().toISOString() });
  for (const [ws, who] of clients) {
    if (!filter(who)) continue;
    try {
      ws.send(message);
    } catch {
      // A dead socket shouldn't break the loop for everyone else - the
      // heartbeat sweep above will clean it out shortly.
    }
  }
}

// All no-op-safe when init() was never called (e.g. under Jest, or in the
// scheduler worker) - callers don't need to guard every call site.

/** Every signed-in staff page. */
function broadcastDashboardEvent(event, payload) {
  send((who) => who.kind === 'staff', 'dashboard:event', event, payload);
}

/** Only these staff members' pages. */
function sendToStaff(staffIds, event, payload) {
  const ids = new Set((staffIds || []).map(Number));
  if (ids.size) send((who) => who.kind === 'staff' && ids.has(Number(who.id)), 'dashboard:event', event, payload);
}

/** Only these candidates' pages. */
function sendToCandidates(candidateIds, event, payload) {
  const ids = new Set((candidateIds || []).map(Number));
  if (ids.size) send((who) => who.kind === 'candidate' && ids.has(Number(who.id)), 'candidate:event', event, payload);
}

/** Every signed-in candidate page - only for what any candidate may see (the job list). */
function broadcastToCandidates(event, payload) {
  send((who) => who.kind === 'candidate', 'candidate:event', event, payload);
}

/** Whether this process serves the sockets (the API), as opposed to the scheduler worker. */
const isRunning = () => running;
const hasClients = (kind) => [...clients.values()].some((who) => who.kind === kind);

module.exports = { init, broadcastDashboardEvent, sendToStaff, sendToCandidates, broadcastToCandidates, isRunning, hasClients };
