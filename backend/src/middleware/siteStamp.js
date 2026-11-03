// Which of the three sites a request came through, as production's nginx
// stamps it: X-ERecruitment-Site staff (HR workspace), internal (Internal
// Careers) or public (careers). nginx always sets the header itself, so a
// visitor can't send their own and pass as the HR site.
//
// Only with REQUIRE_SITE_HEADER=true (production behind nginx). Without it -
// UAT, local development, the tests - req.site is null and nothing here is
// checked.
//
// With it:
//   - a request without a valid stamp answers 400, except /health and
//     /api/internal/* (the scheduler calls these on 127.0.0.1 directly);
//   - on public, staff sign-in (/api/staff/auth/*) and Microsoft candidate
//     sign-in (POST /api/candidates/auth/entra) answer 404: employees sign
//     in on Internal Careers, staff on the HR site, where the Conditional
//     Access policies apply (nginx refuses these too; this is the second
//     layer);
//   - sessionRefusal (used wherever a session token is read: auth.js,
//     fileController, the dashboard socket) refuses a staff session on any
//     site but staff, and an Internal candidate's session on public, 401.
const SITES = ['staff', 'internal', 'public'];
const HEADER = 'x-erecruitment-site';

function siteHeaderRequired() {
  return process.env.REQUIRE_SITE_HEADER === 'true';
}

const exempt = (path) => path === '/health' || path.startsWith('/health/') || path.startsWith('/api/internal/');

// The stamp on a request, or null when stamps aren't in use. Also reads a
// WebSocket upgrade request (dashboardSocket.js).
function siteOf(req) {
  if (!siteHeaderRequired()) return null;
  const value = String(req.headers[HEADER] || '').trim().toLowerCase();
  return SITES.includes(value) ? value : undefined;
}

function middleware(req, res, next) {
  req.site = null;
  if (!siteHeaderRequired() || exempt(req.path)) return next();
  const site = siteOf(req);
  if (!site) return res.status(400).json({ error: 'Bad request', code: 'SITE_HEADER_REQUIRED' });
  req.site = site;
  if (site === 'public' && (req.path.startsWith('/api/staff/auth/')
    || (req.method === 'POST' && req.path === '/api/candidates/auth/entra'))) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

// Why this session can't be used on this site (to answer 401 with), or null.
// `user` is the decoded session token; candidateType may be passed fresher
// than the token's (it changes at a first Microsoft sign-in).
function sessionRefusal(site, user, candidateType = user && user.candidateType) {
  if (!site || !user) return null;
  if (user.type === 'staff' && site !== 'staff') {
    return 'Staff sign in on the e-Recruitment HR site.';
  }
  if (user.type === 'candidate' && site === 'public' && candidateType === 'Internal') {
    return 'UCAA employees apply through Internal Careers.';
  }
  return null;
}

module.exports = { middleware, siteOf, sessionRefusal, siteHeaderRequired, SITES };
