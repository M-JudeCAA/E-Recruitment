// Staff sign-in only works on the HR site: the build served on this port
// (frontend/package.json's "preview:staff" - see SETUP.md "Staff access on
// a separate port"), or, in production, the host VITE_STAFF_HOST names
// (site.js). One static bundle serves every site, so this is checked at
// runtime against window.location rather than baked in at build time.
import { STAFF_PORT, currentSite } from './site';

export { STAFF_PORT };

export function isStaffPort() {
  return currentSite() === 'staff';
}
