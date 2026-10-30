import { useEffect, useState } from 'react';
import staffClient from './staffApiClient';

// The staff Inbox (GET /api/dashboard/inbox), shared by the Inbox page and
// the sidebar's count, so moving between staff pages doesn't refetch it each
// time. refreshInbox() reloads it for everyone showing it - call it after an
// action that clears or adds a task.
let cache = null;
let inflight = null;
// Each refresh's number: an answer to an older request that arrives after a
// newer one (a slow first load, then a refresh after an action) is dropped,
// so it can't put back counts the action already changed.
let latest = 0;
const listeners = new Set();

// Fired after each refresh, so the bell reloads too - the API clears notices
// about whatever the action just dealt with.
export const INBOX_REFRESHED_EVENT = 'inbox-refreshed';

export function refreshInbox() {
  if (!localStorage.getItem('staffToken')) return Promise.resolve(null);
  const mine = ++latest;
  const request = staffClient.get('/api/dashboard/inbox')
    .then((res) => {
      if (mine !== latest) return cache;
      cache = res.data;
      listeners.forEach((fn) => fn(cache));
      window.dispatchEvent(new Event(INBOX_REFRESHED_EVENT));
      return cache;
    })
    .catch(() => cache)
    .finally(() => { if (inflight === request) inflight = null; });
  inflight = request;
  return request;
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
