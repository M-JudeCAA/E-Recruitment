jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/realtime/dashboardSocket', () => ({ broadcastDashboardEvent: jest.fn() }));

const prisma = require('../src/config/db');
const panelDayController = require('../src/controllers/panelDayController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// 2030-10-01 in Kampala (UTC+3): Ann's first interview at 10:00 local
// (07:00Z), her second at 13:00 local (10:00Z).
const LINK = {
  id: 1, token: 'tok', vacancyId: 3, day: '2030-10-01', panelistName: 'Ann', panelistEmail: 'ann@example.test',
  staffUserId: null, revokedAt: null, vacancy: { id: 3, jobRef: 'UCAA/1', title: 'Air Traffic Controller' }
};

function round(id, scheduledDate, panelMembers, overrides = {}) {
  return {
    id, roundNumber: 1, status: 'Scheduled', scheduledDate: new Date(scheduledDate), durationMinutes: 60,
    mode: 'In-person', location: 'Board Room', criteria: null, calledInAt: null,
    application: {
      id: id + 100, candidateId: id + 200,
      candidate: { id: id + 200, fullName: `Candidate ${id}`, email: `c${id}@example.test` },
      vacancy: { id: 3, jobRef: 'UCAA/1', title: 'Air Traffic Controller', createdById: 2 }
    },
    panelMembers,
    ...overrides
  };
}

// Candidate 1 has been called in; candidate 3 hasn't.
function dayRounds({ firstCalledIn = true } = {}) {
  return [
    round(1, '2030-10-01T07:00:00Z', [
      { id: 11, name: 'Ann', email: 'ann@example.test', score: null, recusedAt: null, isChair: true },
      { id: 12, name: 'Bob', email: 'bob@example.test', score: 64, recusedAt: null, isChair: false }
    ], { calledInAt: firstCalledIn ? new Date('2030-10-01T07:05:00Z') : null }),
    // Ann isn't on this one's panel - it must not appear on her link.
    round(2, '2030-10-01T08:00:00Z', [{ id: 21, name: 'Bob', email: 'bob@example.test', score: null, recusedAt: null }]),
    round(3, '2030-10-01T10:00:00Z', [{ id: 31, name: 'Ann', email: 'ANN@example.test', score: null, recusedAt: null, isChair: false }])
  ];
}

const RUNNING = { id: 9, vacancyId: 3, day: '2030-10-01', startedAt: new Date('2030-10-01T06:55:00Z'), endedAt: null, closesAt: null };

function at(iso) {
  jest.setSystemTime(new Date(iso));
}

beforeAll(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  prisma.panelDayLink.findUnique.mockResolvedValue(LINK);
  prisma.interviewRound.findMany.mockResolvedValue(dayRounds());
  prisma.interviewDay.findUnique.mockResolvedValue(RUNNING);
  prisma.panelMember.updateMany.mockResolvedValue({ count: 1 });
  prisma.panelAccessToken.updateMany.mockResolvedValue({ count: 0 });
  prisma.panelMember.findUnique.mockResolvedValue({ id: 11, interviewRoundId: 1 });
  prisma.panelMember.findMany.mockResolvedValue([]);
  prisma.interviewRound.findUnique.mockResolvedValue(null);
});

describe('view', () => {
  test('lists every candidate this panelist interviews that day; only called-in ones are open', async () => {
    at('2030-10-01T07:30:00Z');
    const res = mockRes();
    await panelDayController.view({ params: { token: 'tok' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.sessionState).toBe('running');
    expect(body.candidates.map((c) => [c.candidateName, c.state])).toEqual([
      ['Candidate 1', 'open'],
      ['Candidate 3', 'waiting']
    ]);
    // The day's rounds are looked up in Kampala time: local midnight to midnight.
    expect(prisma.interviewRound.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { application: { vacancyId: 3 }, scheduledDate: { gte: new Date('2030-09-30T21:00:00Z'), lt: new Date('2030-10-01T21:00:00Z') } }
    }));
    // Nothing about the other panelists.
    expect(JSON.stringify(body)).not.toContain('Bob');
  });

  test('before HR starts the session everyone is waiting, whatever the clock says', async () => {
    at('2030-10-01T09:00:00Z');
    prisma.interviewDay.findUnique.mockResolvedValue(null);
    prisma.interviewRound.findMany.mockResolvedValue(dayRounds({ firstCalledIn: false }));
    const res = mockRes();
    await panelDayController.view({ params: { token: 'tok' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.sessionState).toBe('notStarted');
    expect(body.candidates.every((c) => c.state === 'waiting')).toBe(true);
  });

  test('closes at local midnight if the session is never ended', async () => {
    at('2030-10-01T21:05:00Z');
    const res = mockRes();
    await panelDayController.view({ params: { token: 'tok' } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
  });

  test('closes when the grace period after the session ends is over', async () => {
    prisma.interviewDay.findUnique.mockResolvedValue({
      ...RUNNING, endedAt: new Date('2030-10-01T12:00:00Z'), closesAt: new Date('2030-10-01T12:15:00Z')
    });
    at('2030-10-01T12:10:00Z');
    const during = mockRes();
    await panelDayController.view({ params: { token: 'tok' } }, during);
    expect(during.json.mock.calls[0][0].sessionState).toBe('ending');

    at('2030-10-01T12:16:00Z');
    const after = mockRes();
    await panelDayController.view({ params: { token: 'tok' } }, after);
    expect(after.status).toHaveBeenCalledWith(410);
  });

  test('a revoked link no longer works', async () => {
    at('2030-10-01T07:30:00Z');
    prisma.panelDayLink.findUnique.mockResolvedValue({ ...LINK, revokedAt: new Date() });
    const res = mockRes();
    await panelDayController.view({ params: { token: 'tok' } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
  });
});

describe('score', () => {
  test('records a score for a candidate HR has called in', async () => {
    at('2030-10-01T07:50:00Z');
    const res = mockRes();
    await panelDayController.score({ params: { token: 'tok' }, body: { panelMemberId: 11, score: 72, comments: ' Solid ' } }, res);

    expect(prisma.panelMember.updateMany).toHaveBeenCalledWith({
      where: { id: 11, score: null, recusedAt: null },
      data: expect.objectContaining({ score: 72, comments: 'Solid', selfSubmitted: true })
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ score: 72 }));
  });

  test('refuses a candidate not called in yet, even after their booked time', async () => {
    at('2030-10-01T10:30:00Z');
    const res = mockRes();
    await panelDayController.score({ params: { token: 'tok' }, body: { panelMemberId: 31, score: 72 } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(prisma.panelMember.updateMany).not.toHaveBeenCalled();
  });

  test('nothing can be scored before HR starts the session', async () => {
    at('2030-10-01T07:50:00Z');
    prisma.interviewDay.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await panelDayController.score({ params: { token: 'tok' }, body: { panelMemberId: 11, score: 72 } }, res);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(prisma.panelMember.updateMany).not.toHaveBeenCalled();
  });

  test('scoring still works in the grace period after the session ends', async () => {
    prisma.interviewDay.findUnique.mockResolvedValue({
      ...RUNNING, endedAt: new Date('2030-10-01T12:00:00Z'), closesAt: new Date('2030-10-01T12:15:00Z')
    });
    at('2030-10-01T12:05:00Z');
    const res = mockRes();
    await panelDayController.score({ params: { token: 'tok' }, body: { panelMemberId: 11, score: 72 } }, res);
    expect(prisma.panelMember.updateMany).toHaveBeenCalled();
  });

  test('refuses a candidate this panelist is not interviewing', async () => {
    at('2030-10-01T08:30:00Z');
    const res = mockRes();
    await panelDayController.score({ params: { token: 'tok' }, body: { panelMemberId: 21, score: 72 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.panelMember.updateMany).not.toHaveBeenCalled();
  });

  test('a candidate can only be scored once', async () => {
    at('2030-10-01T07:50:00Z');
    prisma.panelMember.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await panelDayController.score({ params: { token: 'tok' }, body: { panelMemberId: 11, score: 72 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('recuse', () => {
  test('a panelist can stand down for a candidate before the session even starts', async () => {
    at('2030-10-01T05:00:00Z');
    prisma.interviewDay.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await panelDayController.recuse({ params: { token: 'tok' }, body: { panelMemberId: 31, reason: 'Related to the candidate' } }, res);
    expect(prisma.panelMember.updateMany).toHaveBeenCalledWith({
      where: { id: 31, score: null, recusedAt: null },
      data: expect.objectContaining({ recusedAt: expect.any(Date) })
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
