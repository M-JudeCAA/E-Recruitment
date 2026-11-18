import { useEffect, useState } from 'react';
import client from './apiClient';

// GET /api/site-status, asked once per page load and shared: whether the
// public careers site is open (backend config/externalSite.js), and whether
// HR's employment check of internal candidates is required (off only on a
// test server, backend utils/employmentCheck.js). Until the answer arrives the
// values are null; if the API can't be reached both are taken as before these
// switches existed (open, required) - the API still enforces what it allows.
let pending = null;

function fetchSiteStatus() {
  if (!pending) {
    pending = client.get('/api/site-status')
      .then((r) => ({ externalSite: r.data?.externalSite !== false, employmentCheckRequired: r.data?.employmentCheckRequired !== false }))
      .catch(() => ({ externalSite: true, employmentCheckRequired: true }));
  }
  return pending;
}

export function fetchExternalSiteOpen() {
  return fetchSiteStatus().then((s) => s.externalSite);
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

/** Whether HR's employment check is required here: true, false, or null until known. */
export function useEmploymentCheckRequired() {
  const [required, setRequired] = useState(null);
  useEffect(() => {
    let live = true;
    fetchSiteStatus().then((s) => { if (live) setRequired(s.employmentCheckRequired); });
    return () => { live = false; };
  }, []);
  return required;
}

// For tests: forget the cached answer.
export function resetSiteStatus() {
  pending = null;
}
