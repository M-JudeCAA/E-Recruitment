require('dotenv').config();

// Every session and the scheduler's signal are signed with JWT_SECRET; a
// short or missing one in production is refused outright rather than
// signing sessions anyone could forge.
if (process.env.NODE_ENV === 'production' && String(process.env.JWT_SECRET || '').length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters in production. Not starting.');
  process.exit(1);
}
// Express 4 does not forward a rejected promise from an async route
// handler to the error middleware below on its own - an uncaught
// rejection there (e.g. a transient database blip) is a plain unhandled
// rejection, and modern Node's default behavior for those is to
// terminate the process outright, taking the whole API down for every
// user rather than just failing that one request. This is a last-resort
// safety net so a single bad request can't do that; asyncHandler.js
// (used in routes/candidates.js) is the actual per-request fix, giving
// the caller a real 500 instead of a hung connection.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (server kept running):', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server kept running):', err);
});

const app = require('./app');
const { verifyMailTransport } = require('./utils/mailer');

const PORT = process.env.PORT || 4000;
// HOST=127.0.0.1 keeps the API off the network where a proxy on the same
// machine is the only way in (deploy/lan/); unset, every interface as before.
const HOST = process.env.HOST || undefined;
const httpServer = app.listen(PORT, HOST, () => console.log(`e-Recruitment API listening on ${HOST || 'all interfaces'}, port ${PORT}`));

// Push channel for the HR dashboards (see realtime/dashboardSocket.js) -
// attached to the same HTTP server/port rather than a separate one, so
// there's nothing extra to open in a firewall/reverse proxy config.
require('./realtime/dashboardSocket').init(httpServer);

// Report wrong SMTP settings the moment the API starts, not after the
// first candidate misses an email - see utils/mailer.js. Never throws.
verifyMailTransport();

// Staff and internal candidates sign in with Microsoft (services/entraAuthService.js).
// Say so at start-up when it isn't set up, rather than on the first sign-in.
{
  const entra = require('./services/entraAuthService');
  for (const app of ['staff', 'candidate']) {
    if (!entra.isConfigured(app)) console.warn(`Microsoft sign-in (${app}) is not configured - set ENTRA_TENANT_ID and ENTRA_${app.toUpperCase()}_CLIENT_ID.`);
  }
  if (process.env.BREAK_GLASS_LOGIN === 'true') console.warn('BREAK_GLASS_LOGIN is on: system administrators can sign in with a password. Turn it off once Microsoft sign-in works again.');
  if (process.env.DEV_PASSWORD_LOGIN === 'true' && process.env.NODE_ENV === 'production') console.warn('DEV_PASSWORD_LOGIN is ignored in production.');
}
