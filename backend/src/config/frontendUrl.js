// FRONTEND_URL is a comma-separated list of allowed CORS origins: the
// guest-facing origin first, then the staff-only preview port added
// alongside it (see SETUP.md "Staff access on a separate port"). The
// frontend also enforces this split at runtime (ProtectedRoute.jsx's
// RequireStaffPort bounces /staff/login, /staff/forgot-password and
// /staff/reset-password back to "/" unless served from the staff port),
// so links to those routes MUST use staffFrontendUrl, not frontendUrl -
// an emailed staff link pointing at the guest origin would 404 itself.
const origins = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  allowedOrigins: origins,
  frontendUrl: origins[0] || '',
  staffFrontendUrl: origins[1] || origins[0] || '',
};
