import { useRef } from 'react';
import { createLiveChannel, useLiveChannel } from './liveChannel';
import { debounce } from '../utils/debounce';

// The staff live channel - see backend/src/realtime/dashboardSocket.js for
// the design and services/liveUpdateService.js for what is sent: `Changed`
// ({ entityType, entityId, action, by }) after every audited change,
// `NotificationsChanged` when the viewer gets a notice, and the older named
// events (VacancyApproved, OfferPendingApproval, ...). It only ever says
// when to refetch; each page stays the source of truth for its own data.
export const staffChannel = createLiveChannel({ path: '/ws/dashboard', tokenKey: 'staffToken', messageType: 'dashboard:event' });

/** Calls onEvent(event, payload) on every staff signal while the component is mounted. */
export function useDashboardEvents(onEvent) {
  return useLiveChannel(staffChannel, onEvent);
}

/**
 * Re-runs reload() (debounced) whenever something changes, for as long as
 * the page is open - one line for any staff page that should stay current
 * without a refresh.
 */
export function useLiveRefresh(reload, ms = 600) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const soon = useRef(null);
  if (!soon.current) soon.current = debounce(() => reloadRef.current?.(), ms);
  return useDashboardEvents(() => soon.current());
}
