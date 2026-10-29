// The public careers site, where External candidates register and apply, can
// be closed for a time (EXTERNAL_SITE_ENABLED=false in .env, then restart the
// API). While it is closed the public address shows a notice instead of the
// site (the frontend asks GET /api/site-status), password registration,
// sign-in and resets answer 403 EXTERNAL_SITE_CLOSED, and so does every
// candidate route for an External account. Internal Careers, the staff app
// and the shortlisting committee's links are unaffected. Read on every call,
// so tests can change it.
const CLOSED_MESSAGE = 'The UCAA careers site for external applicants is closed for now. Please check back later.';

function externalSiteOpen() {
  return String(process.env.EXTERNAL_SITE_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

function refuseClosed(res) {
  return res.status(403).json({ error: CLOSED_MESSAGE, code: 'EXTERNAL_SITE_CLOSED' });
}

// Route middleware for the public site's own endpoints (password sign-in and registration).
function requireExternalSiteOpen(req, res, next) {
  if (!externalSiteOpen()) return refuseClosed(res);
  next();
}

module.exports = { externalSiteOpen, refuseClosed, requireExternalSiteOpen, CLOSED_MESSAGE };
