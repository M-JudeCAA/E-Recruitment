require('dotenv').config();
const express = require('express');
const cors = require('cors');

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

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL }));
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

// Basic error handler - catches Multer file-validation errors etc.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`e-Recruitment API listening on port ${PORT}`));
