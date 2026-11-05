jest.mock('../src/config/db', () => require('./__mocks__/db'));
const http = require('http');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const prisma = require('../src/config/db');
const socket = require('../src/realtime/dashboardSocket');

process.env.JWT_SECRET = 'test-secret';
const token = (claims) => jwt.sign(claims, process.env.JWT_SECRET);

describe('broadcastDashboardEvent', () => {
  test('no-ops safely when init() was never called (e.g. under Jest)', () => {
    expect(() => socket.broadcastDashboardEvent('VacancyApproved', { id: 1 })).not.toThrow();
    expect(() => socket.sendToCandidates([1], 'Changed', {})).not.toThrow();
  });
});

describe('the live channel', () => {
  let server;
  let port;
  const open = [];

  beforeAll((done) => {
    server = http.createServer();
    socket.init(server);
    server.listen(0, () => { port = server.address().port; done(); });
  });
  afterAll((done) => { open.forEach((ws) => ws.terminate()); server.close(done); });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.staffUser.findUnique.mockResolvedValue({ id: 7, role: 'HR_Officer', isSystemAdmin: false, active: true });
    prisma.candidate.findUnique.mockResolvedValue({ id: 42, candidateType: 'External', purgedAt: null, tokenVersion: 0 });
  });

  // Connects and authenticates; resolves with the socket and the messages it gets.
  const connect = (path, sessionToken) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    open.push(ws);
    const messages = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      messages.push(msg);
      if (msg.type === 'auth:ok') resolve({ ws, messages, ok: true });
    });
    ws.on('close', (code) => resolve({ ws, messages, ok: false, code }));
    ws.on('error', () => resolve({ ws, messages, ok: false }));
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: sessionToken })));
  });
  const settle = () => new Promise((r) => setTimeout(r, 50));

  test('staff get every staff signal; candidates only their own', async () => {
    const staff = await connect('/ws/dashboard', token({ id: 7, type: 'staff' }));
    const mine = await connect('/ws/candidate', token({ id: 42, type: 'candidate', tv: 0 }));
    prisma.candidate.findUnique.mockResolvedValue({ id: 43, candidateType: 'External', purgedAt: null, tokenVersion: 0 });
    const other = await connect('/ws/candidate', token({ id: 43, type: 'candidate', tv: 0 }));
    expect([staff.ok, mine.ok, other.ok]).toEqual([true, true, true]);

    socket.broadcastDashboardEvent('Changed', { entityType: 'Vacancy', entityId: 1 });
    socket.sendToCandidates([42], 'Changed', { entityType: 'Application', entityId: 9 });
    socket.broadcastToCandidates('JobsChanged', { vacancyId: 1 });
    await settle();

    const events = (c) => c.messages.filter((m) => m.type !== 'auth:ok').map((m) => `${m.type} ${m.event}`);
    expect(events(staff)).toEqual(['dashboard:event Changed']);
    expect(events(mine)).toEqual(['candidate:event Changed', 'candidate:event JobsChanged']);
    expect(events(other)).toEqual(['candidate:event JobsChanged']);
  });

  test('sendToStaff reaches only the staff named', async () => {
    const a = await connect('/ws/dashboard', token({ id: 7, type: 'staff' }));
    prisma.staffUser.findUnique.mockResolvedValue({ id: 8, role: 'HR_Officer', isSystemAdmin: false, active: true });
    const b = await connect('/ws/dashboard', token({ id: 8, type: 'staff' }));
    socket.sendToStaff([8], 'NotificationsChanged', {});
    await settle();
    expect(a.messages.some((m) => m.event === 'NotificationsChanged')).toBe(false);
    expect(b.messages.some((m) => m.event === 'NotificationsChanged')).toBe(true);
  });

  test('refuses a deactivated staff account', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 7, active: false });
    const c = await connect('/ws/dashboard', token({ id: 7, type: 'staff' }));
    expect(c.ok).toBe(false);
    expect(c.code).toBe(4001);
  });

  test('refuses a candidate session that has ended or a staff token on the candidate entrance', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 42, candidateType: 'External', purgedAt: null, tokenVersion: 3 });
    expect((await connect('/ws/candidate', token({ id: 42, type: 'candidate', tv: 0 }))).ok).toBe(false);
    prisma.candidate.findUnique.mockResolvedValue({ id: 42, candidateType: 'External', purgedAt: new Date(), tokenVersion: 0 });
    expect((await connect('/ws/candidate', token({ id: 42, type: 'candidate', tv: 0 }))).ok).toBe(false);
    expect((await connect('/ws/candidate', token({ id: 7, type: 'staff' }))).ok).toBe(false);
    expect((await connect('/ws/dashboard', token({ id: 42, type: 'candidate', tv: 0 }))).ok).toBe(false);
  });

  test('refuses an unknown path', async () => {
    const c = await connect('/ws/other', token({ id: 7, type: 'staff' }));
    expect(c.ok).toBe(false);
  });
});
