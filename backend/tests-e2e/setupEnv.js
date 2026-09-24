const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { testDatabaseUrl } = require('./testDatabaseUrl');

// Runs before each test file loads the app, so config/db.js connects to the
// test database and the app sees test settings.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET = 'e2e-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
// nodemailer's jsonTransport: emails are built and discarded, never sent.
process.env.SMTP_HOST = 'json';
process.env.SMTP_FROM = 'e-recruitment@caa.co.ug';
