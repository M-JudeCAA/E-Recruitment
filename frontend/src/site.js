// Which of the three sites this page is: 'staff' (HR workspace), 'internal'
// (Internal Careers) or 'public' (careers). One static build serves all
// three, so it is decided at runtime from window.location:
//
//   - by host name, when the build sets VITE_STAFF_HOST / VITE_INTERNAL_HOST
//     (production: erecruitment.caa.co.ug, internal-careers.caa.co.ug; any
//     other host is the public site);
//   - otherwise by port, as on UAT and in local development: STAFF_PORT
//     (4174) and INTERNAL_PORT (4175), everything else public.
//
// isStaffPort() (staffPort.js) and isInternalPort() (internalPort.js) ask
// this, so every gate (RequireStaffPort, GuestPortGate, InternalPortGate)
// and the .staff-ui switch in App.jsx follow it.
export const STAFF_PORT = import.meta.env.VITE_STAFF_PORT || '4174';
export const INTERNAL_PORT = import.meta.env.VITE_INTERNAL_PORT || '4175';

const hostSetting = (value) => String(value || '').trim().toLowerCase();

export function currentSite() {
  const staffHost = hostSetting(import.meta.env.VITE_STAFF_HOST);
  const internalHost = hostSetting(import.meta.env.VITE_INTERNAL_HOST);
  if (staffHost || internalHost) {
    const host = window.location.hostname.toLowerCase();
    if (staffHost && host === staffHost) return 'staff';
    if (internalHost && host === internalHost) return 'internal';
    return 'public';
  }
  if (window.location.port === STAFF_PORT) return 'staff';
  if (window.location.port === INTERNAL_PORT) return 'internal';
  return 'public';
}
