const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

// Push-based "something changed, go refetch" channel for the four HR
// dashboards (HRHome/ExecutiveDashboard/ApprovalsCenter/HRDashboard) - it
// carries signals, not data. The server broadcasts a tiny {event, payload}
// message when a dashboard-relevant mutation happens; every connected
// dashboard re-runs its own existing REST fetch in response. This is
// deliberately NOT a full duplex data-sync layer: the REST endpoints
// (dashboardController.js) stay the single source of truth, so there's no
// risk of the socket and the database ever disagreeing about what's true.
//
// Auth is a first-message handshake, not a `?token=` query param - the
// browser WebSocket API can't set an Authorization header (same underlying
// limitation as EventSource), but CLAUDE.md is explicit that the
// query-param-token pattern used for /api/files/:filename must not be
// extended to other routes. A first-message handshake keeps the JWT out of
// the URL entirely (never touches server/proxy access logs).
//
// Broadcasts go to every authenticated staff connection regardless of role
// - payloads are a few bytes, and each dashboard's client-side hook
// (frontend/src/models/dashboardSocket.js) already decides which `event`
// names it cares about, so there's no need for server-side per-connection
// role bookkeeping.

const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

let wss = null;
const clients = new Set();

function authenticateSocket(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return ws.close(4001, 'Unauthorized');
  }
  if (msg.type !== 'auth' || typeof msg.token !== 'string') return ws.close(4001, 'Unauthorized');

  let decoded;
  try {
    decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
  } catch {
    return ws.close(4001, 'Unauthorized');
  }
  if (decoded.type !== 'staff') return ws.close(4001, 'Unauthorized');

  ws.isAlive = true;
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'auth:ok' }));
}

function init(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws/dashboard' });

  wss.on('connection', (ws) => {
    const authTimer = setTimeout(() => {
      if (!clients.has(ws)) ws.close(4001, 'Unauthorized'); // never authenticated within the window
    }, AUTH_TIMEOUT_MS);

    // A connection only ever sends one meaningful message (the auth
    // handshake) - anything after that is ignored rather than parsed again,
    // since this channel has no other client->server traffic.
    ws.once('message', (raw) => {
      clearTimeout(authTimer);
      authenticateSocket(ws, raw);
    });

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Standard `ws` dead-connection sweep: a client that didn't answer the
  // previous ping (e.g. laptop closed without a clean close frame) gets
  // terminated instead of silently accumulating as a broadcast target that
  // will never actually receive anything.
  setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS).unref();

  return wss;
}

// No-op-safe when init() was never called (e.g. under Jest, or before the
// server has finished starting) - callers (controllers/services) don't need
// to guard every call site themselves.
function broadcastDashboardEvent(event, payload) {
  if (clients.size === 0) return;
  const message = JSON.stringify({ type: 'dashboard:event', event, payload: payload || {}, at: new Date().toISOString() });
  for (const ws of clients) {
    try {
      ws.send(message);
    } catch {
      // A dead socket shouldn't break the broadcast loop for everyone else
      // - the heartbeat sweep above will clean it out of `clients` shortly.
    }
  }
}

module.exports = { init, broadcastDashboardEvent };
