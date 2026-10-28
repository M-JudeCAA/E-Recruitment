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
const shortlistCommitteeRoutes = require('./routes/shortlistCommittee');
const shortlistPanelRoutes = require('./routes/shortlistPanel');
const departmentRoutes = require('./routes/departments');
const positionRoutes = require('./routes/positions');
const orgImportRoutes = require('./routes/orgImport');
const directorateRoutes = require('./routes/directorates');
const staffUsersRoutes = require('./routes/staffUsers');
const delegationRoutes = require('./routes/delegations');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');
const auditRoutes = require('./routes/audit');
const vacancyDraftRoutes = require('./routes/vacancyDrafts');
const directoryRoutes = require('./routes/directory');
const documentRoutes = require('./routes/documents');
const settingsRoutes = require('./routes/settings');
const dataProtectionRoutes = require('./routes/dataProtection');
const talentRoutes = require('./routes/talent');
const bulkEmailRoutes = require('./routes/bulkEmail');
const { errorHandler } = require('./utils/errorResponse');
const { verifySignal } = require('./utils/dashboardSignal');
const { broadcastDashboardEvent } = require('./realtime/dashboardSocket');

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
// Browser security headers on every answer. The API sends JSON and files,
// never pages, so its CSP allows nothing to load - except that the app's own
// sites may frame it (the document viewer shows PDFs from /api/files in a
// frame, from another port in development). Resources are same-site so the
// app on another port can still show a profile photo from here.
app.use(require('helmet')({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'self'", ...allowedOrigins] }
  },
  xFrameOptions: false, // frame-ancestors above decides, and allows the app's other ports
  crossOriginResourcePolicy: { policy: 'same-site' },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: false }
}));
// Content-Disposition is exposed so the SPA (another origin) can save a CSV
// export under the filename the server gave it (CsvDownloadButton.jsx).
app.use(cors({ origin: allowedOrigins, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json());
// Who is asking and from where, for every audit row written while a request
// runs (after express.json, which would lose the context), and the activity
// log of every change request (utils/requestContext.js,
// services/activityLogService.js).
app.use(require('./utils/requestContext').middleware);
app.use(require('./services/activityLogService').middleware);

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
app.use('/api/shortlist-committee', shortlistCommitteeRoutes);
// Public - a shortlisting committee member's private link.
app.use('/api/shortlist-panel', shortlistPanelRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/org-import', orgImportRoutes);
app.use('/api/directorates', directorateRoutes);
app.use('/api/staff-users', staffUsersRoutes);
app.use('/api/delegations', delegationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/admin/audit', require('./routes/adminAudit'));
app.use('/api/vacancy-drafts', vacancyDraftRoutes);
app.use('/api/directory', directoryRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/data-protection', dataProtectionRoutes);
app.use('/api/talent', talentRoutes);
app.use('/api/bulk-email', bulkEmailRoutes);
app.use('/api/feedback', require('./routes/feedback'));

// The scheduler worker's "something changed" signal for the HR dashboards
// (utils/dashboardSignal.js) - signed with the shared secret, no session.
app.post('/api/internal/dashboard-events', (req, res) => {
  if (!verifySignal(req)) return res.status(401).json({ error: 'Invalid signature' });
  broadcastDashboardEvent(String(req.body.event).slice(0, 60), req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {});
  res.status(204).end();
});

// Catch-all error handler - logs the full error server-side but only ever
// sends the client a sanitized message (never Prisma query text, database
// host names, or stack details). See utils/errorResponse.js.
app.use(errorHandler);

module.exports = app;
