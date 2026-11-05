import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLiveChannel, closeLiveChannels } from '../../src/models/liveChannel';

// A stand-in for the browser's WebSocket: records what is sent and lets the
// test play the server.
class FakeSocket {
  static all = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeSocket.all.push(this);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { if (!this.closed) { this.closed = true; this.onclose?.(); } }
  open() { this.onopen?.(); }
  receive(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

let channel;
beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
  localStorage.setItem('staffToken', 'token-a');
  channel = createLiveChannel({ path: '/ws/dashboard', tokenKey: 'staffToken', messageType: 'dashboard:event' });
});
afterEach(() => {
  closeLiveChannels();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a live channel', () => {
  it('shares one connection, authenticates with the session token and hands events to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    channel.subscribe(a);
    channel.subscribe(b);
    expect(FakeSocket.all).toHaveLength(1);
    const ws = FakeSocket.all[0];
    expect(ws.url).toMatch(/\/ws\/dashboard$/);
    ws.open();
    expect(ws.sent).toEqual([{ type: 'auth', token: 'token-a' }]);

    ws.receive({ type: 'auth:ok' });
    expect(channel.isConnected()).toBe(true);
    ws.receive({ type: 'dashboard:event', event: 'Changed', payload: { entityType: 'Vacancy', entityId: 3 } });
    ws.receive({ type: 'candidate:event', event: 'JobsChanged' }); // not this channel's
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith('Changed', { entityType: 'Vacancy', entityId: 3 });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('opens nothing without a session and closes when the last subscriber leaves', () => {
    localStorage.removeItem('staffToken');
    const off = channel.subscribe(() => {});
    expect(FakeSocket.all).toHaveLength(0);
    off();

    localStorage.setItem('staffToken', 'token-a');
    const off2 = channel.subscribe(() => {});
    off2();
    expect(FakeSocket.all[0].closed).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(FakeSocket.all).toHaveLength(1); // no reconnecting for nobody
  });

  it('reconnects after a dropped connection, and starts afresh for a new session', () => {
    channel.subscribe(() => {});
    FakeSocket.all[0].close(); // dropped
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);

    closeLiveChannels(); // sign-out
    localStorage.setItem('staffToken', 'token-b');
    channel.subscribe(() => {});
    const latest = FakeSocket.all[FakeSocket.all.length - 1];
    latest.open();
    expect(latest.sent).toEqual([{ type: 'auth', token: 'token-b' }]);
  });
});
