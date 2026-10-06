// UCAA Internal Careers - the site UCAA employees apply from - is the same
// build served on its own port (`npm run preview:internal`, 4175 by
// default), the way staff use 4174 (staffPort.js). On it, sign-in is
// Microsoft only and only Internal vacancies exist; the public careers
// site keeps email + password for everyone else. Checked at runtime against
// window.location, since one static bundle serves every port.
export const INTERNAL_PORT = import.meta.env.VITE_INTERNAL_PORT || '4175';

export function isInternalPort() {
  return window.location.port === INTERNAL_PORT;
}

// Where each site lives, for the links between them. Set the VITE_ values
// when the sites have their own host names; otherwise the same host is
// assumed (the public site on 5173 when running locally).
export function internalSiteUrl() {
  return import.meta.env.VITE_INTERNAL_SITE_URL || `${window.location.protocol}//${window.location.hostname}:${INTERNAL_PORT}`;
}

export function publicSiteUrl() {
  if (import.meta.env.VITE_PUBLIC_SITE_URL) return import.meta.env.VITE_PUBLIC_SITE_URL;
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return `${window.location.protocol}//${window.location.hostname}${local ? ':5173' : ''}`;
}
