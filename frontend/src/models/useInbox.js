import { useEffect, useState } from 'react';
import staffClient from './staffApiClient';

// The staff Inbox (GET /api/dashboard/inbox), shared by the Inbox page and
// the sidebar's count, so moving between staff pages doesn't refetch it each
// time. refreshInbox() reloads it for everyone showing it - call it after an
// action that clears or adds a task.
let cache = null;
let inflight = null;
const listeners = new Set();

export function refreshInbox() {
  if (!localStorage.getItem('staffToken')) return Promise.resolve(null);
  inflight = staffClient.get('/api/dashboard/inbox')
    .then((res) => { cache = res.data; listeners.forEach((fn) => fn(cache)); return cache; })
    .catch(() => cache)
    .finally(() => { inflight = null; });
  return inflight;
}

export function useInbox({ enabled = true } = {}) {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(setData);
    if (!cache && !inflight) refreshInbox();
    return () => { listeners.delete(setData); };
  }, [enabled]);
  return data;
}

/** Forget the cached inbox (sign-out), so the next person never sees it. */
export function clearInbox() {
  cache = null;
}
