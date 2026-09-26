// Staff sign-in only works from this port (frontend/package.json's
// "preview:staff" serves the same build on it - see SETUP.md "Staff
// access on a separate port"). It's a single static bundle served on two
// ports, so this has to be checked at runtime against window.location
// rather than baked in at build time.
export const STAFF_PORT = import.meta.env.VITE_STAFF_PORT || '4174';

// Hosted deployments (e.g. Render, see render.yaml) serve every site on the
// default HTTPS port, so the port can't tell the two apart there. Instead
// the staff site is its own build with VITE_STAFF_SITE=true, which makes
// the whole bundle behave as if it were on the staff port.
const STAFF_SITE = import.meta.env.VITE_STAFF_SITE === 'true';

export function isStaffPort() {
  return STAFF_SITE || window.location.port === STAFF_PORT;
}
