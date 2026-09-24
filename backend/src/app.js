// The Express application - routes, middleware and error handling - with
// no network listener, so the end-to-end tests (tests-e2e/) can drive it
// directly. server.js is what actually starts it.
const express = require('express');
const cors = require('cors');
// Patches Express's router so a rejected promise from an async route
// handler reaches the error middleware below via next(err), instead of
// becoming an unhandled rejection that crashes the whole process (Express
// 4 doesn't catch async handler rejections on its own) - this is what
// actually crashed the server: notificationController.listMine hit a
// Prisma connection-pool timeout with no try/catch, and Node kills the
// process on an unhandled rejection by default.
require('express-async-errors');

const candidateAuthRoutes = require('./routes/candidateAuth');
const staffAuthRoutes = require('./routes/staffAuth');
const applicationRoutes = require('./routes/applications');
const verificationRoutes = require('./routes/verification');
const vacancyRoutes = require('./routes/vacancies');
const interviewRoutes = require('./routes/interviews');
const candidateRoutes = require('./routes/candidates');
const fileRoutes = require('./routes/files');
const panelAccessRoutes = require('./routes/panelAccess');
const departmentRoutes = require('./routes/departments');
const positionRoutes = require('./routes/positions');
const directorateRoutes = require('./routes/directorates');
const staffUsersRoutes = require('./routes/staffUsers');
const delegationRoutes = require('./routes/delegations');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');
const { errorHandler } = require('./utils/errorResponse');

const app = express();

// Which reverse proxies to believe about the client's address
// (X-Forwarded-For). Needed for the per-address limits in
// middleware/rateLimit.js: without it, every request behind a proxy looks
// like it comes from the proxy, and all users would share one budget.
// Default "loopback" trusts a proxy on the same machine (the usual nginx /
// IIS setup) and nothing else, so clients can't fake their address. Set
// TRUST_PROXY to "false", "true", a hop count, or an address/subnet list
// to match the deployment (Express "trust proxy" values).
function parseTrustProxy(value) {
  if (value === undefined || value === '') return 'loopback';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

const { allowedOrigins } = require('./config/frontendUrl');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/candidates/auth', candidateAuthRoutes);
app.use('/api/staff/auth', staffAuthRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/vacancies', vacancyRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/candidates', candidateRoutes);
// Authenticated file access - replaces a plain express.static mount so
// CVs, cover letters, and recommendation letters aren't publicly readable.
app.use('/api/files', fileRoutes);
// Public, unauthenticated - a panelist's scoped access link, not a JWT session.
app.use('/api/panel-access', panelAccessRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/directorates', directorateRoutes);
app.use('/api/staff-users', staffUsersRoutes);
app.use('/api/delegations', delegationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);

// Catch-all error handler - logs the full error server-side but only ever
// sends the client a sanitized message (never Prisma query text, database
// host names, or stack details). See utils/errorResponse.js.
app.use(errorHandler);

module.exports = app;
