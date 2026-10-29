import { useEffect, useState } from 'react';
import client from './apiClient';

// Whether the public careers site is open (backend config/externalSite.js,
// GET /api/site-status). Asked once per page load and shared. Until the
// answer arrives the value is null; if the API can't be reached the site is
// treated as open, as it was before this switch existed - the API still
// refuses what a closed site doesn't allow.
let pending = null;

export function fetchExternalSiteOpen() {
  if (!pending) {
    pending = client.get('/api/site-status')
      .then((r) => r.data?.externalSite !== false)
      .catch(() => true);
  }
  return pending;
}

export function useExternalSiteOpen(enabled = true) {
  const [open, setOpen] = useState(enabled ? null : true);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    fetchExternalSiteOpen().then((value) => { if (live) setOpen(value); });
    return () => { live = false; };
  }, [enabled]);
  return open;
}

// For tests: forget the cached answer.
export function resetSiteStatus() {
  pending = null;
}
