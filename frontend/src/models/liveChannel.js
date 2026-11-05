import { useEffect, useRef, useState } from 'react';
import { API_URL } from './apiClient';

// One live connection per tab and per kind of session, shared by everything
// on the page that wants to know "something changed, go refetch" - see
// backend/src/realtime/dashboardSocket.js. Subscribers get (event, payload)
// and re-run their own REST fetch; nothing here holds data.
//
// The socket opens when the first subscriber arrives and closes when the last
// one leaves (or the session ends - closeLiveChannels). It reconnects with
// capped exponential backoff and degrades silently: every page still works
// from its own load, so a socket that can't connect (a corporate proxy, say)
// costs liveness, not the page.

const MAX_BACKOFF_MS = 30000;
const channels = [];

export function createLiveChannel({ path, tokenKey, messageType }) {
  const url = `${API_URL.replace(/^http/, 'ws')}${path}`;
  const subscribers = new Set();
  const statusListeners = new Set();
  let ws = null;
  let token = null;
  let connected = false;
  let backoff = 1000;
  let reconnectTimer = null;

  const setConnected = (value) => {
    connected = value;
    statusListeners.forEach((fn) => fn(value));
  };

  function connect() {
    reconnectTimer = null;
    token = localStorage.getItem(tokenKey);
    if (!token || subscribers.size === 0) return;
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      backoff = 1000; // a successful connection resets the backoff ladder
      socket.send(JSON.stringify({ type: 'auth', token }));
    };
    socket.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'auth:ok') setConnected(true);
      if (msg.type === messageType) [...subscribers].forEach((fn) => fn(msg.event, msg.payload || {}));
    };
    socket.onclose = () => {
      if (ws !== socket) return; // replaced or stopped on purpose
      ws = null;
      setConnected(false);
      if (subscribers.size === 0) return;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
    socket.onerror = () => socket.close();
  }

  function stop() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const socket = ws;
    ws = null;
    socket?.close();
    if (connected) setConnected(false);
  }

  // Opens the socket when there is someone to tell, and starts again when
  // the session behind it has changed (signed out and back in as someone else).
  function ensure() {
    const current = localStorage.getItem(tokenKey);
    if (!current) { stop(); return; }
    if ((ws || reconnectTimer) && current === token) return;
    stop();
    backoff = 1000;
    connect();
  }

  const channel = {
    subscribe(fn) {
      subscribers.add(fn);
      ensure();
      return () => {
        subscribers.delete(fn);
        if (subscribers.size === 0) stop();
      };
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    isConnected: () => connected,
    close: stop
  };
  channels.push(channel);
  return channel;
}

/** Closes every live connection - on sign-out, so the next session starts afresh. */
export function closeLiveChannels() {
  channels.forEach((c) => c.close());
}

/**
 * Subscribes a component for as long as it is mounted. onEvent(event,
 * payload) may change between renders; the latest one is called.
 */
export function useLiveChannel(channel, onEvent) {
  const [connected, setConnected] = useState(channel.isConnected());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const offStatus = channel.onStatus(setConnected);
    const unsubscribe = channel.subscribe((event, payload) => onEventRef.current?.(event, payload));
    setConnected(channel.isConnected());
    return () => { offStatus(); unsubscribe(); };
  }, [channel]);

  return { connected };
}
