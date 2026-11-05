import { createLiveChannel, useLiveChannel } from './liveChannel';

// The candidate live channel (backend/src/realtime/dashboardSocket.js,
// /ws/candidate): `Changed` when one of the candidate's own records changes
// (an application, offer, interview, employment check), `NotificationsChanged`
// when they get a notice, and `JobsChanged` when a vacancy opens, closes or
// changes. Signals only - the pages re-read through the API.
export const candidateChannel = createLiveChannel({ path: '/ws/candidate', tokenKey: 'candidateToken', messageType: 'candidate:event' });

/** Calls onEvent(event, payload) on every candidate signal while the component is mounted. */
export function useCandidateEvents(onEvent) {
  return useLiveChannel(candidateChannel, onEvent);
}
