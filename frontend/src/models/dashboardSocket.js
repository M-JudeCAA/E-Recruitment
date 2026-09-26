import { useEffect, useRef, useState } from 'react';
import { API_URL } from './apiClient';

// ws(s):// derived from the same API_URL apiClient.js already uses - one
// place to change if the API host ever changes.
const WS_URL = `${API_URL.replace(/^http/, 'ws')}/ws/dashboard`;
const MAX_BACKOFF_MS = 30000;

// Push channel for the HR dashboards - see backend/src/realtime/dashboardSocket.js
// for the full design rationale. This hook only ever calls `onEvent(event,
// payload)`; it never holds dashboard data itself, so a dashboard view stays
// the single source of truth for its own state (fetched via the normal REST
// endpoints) and this hook is purely "tell me when to go refetch".
//
// Reconnects with capped exponential backoff and degrades silently if the
// socket can never connect (corporate proxy, etc.) - every dashboard using
// this already works from its own on-mount fetch with or without a live
// connection, so a failed socket is a lost "nice to have," not a broken page.
export function useDashboardEvents(onEvent) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const token = localStorage.getItem('staffToken');
    if (!token) return undefined; // no staff session - nothing to authenticate the socket with

    let ws;
    let closedByCleanup = false;
    let backoff = 1000;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        backoff = 1000; // a successful connection resets the backoff ladder
        ws.send(JSON.stringify({ type: 'auth', token: localStorage.getItem('staffToken') }));
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'auth:ok') setConnected(true);
        if (msg.type === 'dashboard:event') onEventRef.current?.(msg.event, msg.payload);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closedByCleanup) return;
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closedByCleanup = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return { connected };
}
