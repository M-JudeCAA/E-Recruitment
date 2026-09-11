// Staff sign-in only works from this port (frontend/package.json's
// "preview:staff" serves the same build on it - see SETUP.md "Staff
// access on a separate port"). It's a single static bundle served on two
// ports, so this has to be checked at runtime against window.location
// rather than baked in at build time.
export const STAFF_PORT = import.meta.env.VITE_STAFF_PORT || '4174';

export function isStaffPort() {
  return window.location.port === STAFF_PORT;
}
