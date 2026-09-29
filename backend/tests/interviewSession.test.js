jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/realtime/dashboardSocket', () => ({ broadcastDashboardEvent: jest.fn() }));

const prisma = require('../src/config/db');
const interviewController = require('../src/controllers/interviewController');
const checkInterviewSessions = require('../scripts/checkInterviewSessions');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const VACANCY = { id: 3, jobRef: 'UCAA/1', title: 'Air Traffic Controller', createdById: 2 };

function round(id, scheduledDate, overrides = {}) {
  return {
    id, applicationId: id + 100, roundNumber: 1, status: 'Scheduled', scheduledDate: new Date(scheduledDate), durationMinutes: 60,
    mode: 'In-person', location: 'Board Room', criteria: null, calledInAt: null, scheduledById: 9,
    application: { id: id + 100, candidateId: id + 200, candidate: { id: id + 200, fullName: `Candidate ${id}` }, vacancy: VACANCY },
    panelMembers: [],
    ...overrides
  };
}

const staff = { user: { id: 9 } };
const dayParams = { vacancyId: '3', day: '2030-10-01' };

beforeAll(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  jest.setSystemTime(new Date('2030-10-01T06:50:00Z')); // 09:50 in Kampala
  prisma.vacancy.findUnique.mockResolvedValue(VACANCY);
  prisma.interviewRound.findMany.mockResolvedValue([round(1, '2030-10-01T07:00:00Z'), round(2, '2030-10-01T08:00:00Z')]);
  prisma.interviewDay.findUnique.mockResolvedValue(null);
  prisma.interviewDay.upsert.mockResolvedValue({ id: 5, vacancyId: 3, day: '2030-10-01' });
  prisma.interviewDay.updateMany.mockResolvedValue({ count: 1 });
  prisma.staffUser.findMany.mockResolvedValue([]);
});

describe('startDay', () => {
  test('starts the session for today', async () => {
    const res = mockRes();
    await interviewController.startDay({ ...staff, params: dayParams }, res);
    expect(prisma.interviewDay.updateMany).toHaveBeenCalledWith({
      where: { id: 5, startedAt: null }, data: { startedAt: expect.any(Date), startedById: 9 }
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'Interview session started' }) });
    expect(res.status).not.toHaveBeenCalled();
  });

  test('refuses a day other than today', async () => {
    const res = mockRes();
    await interviewController.startDay({ ...staff, params: { vacancyId: '3', day: '2030-10-02' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.interviewDay.updateMany).not.toHaveBeenCalled();
  });

  test('refuses a session already started', async () => {
    prisma.interviewDay.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await interviewController.startDay({ ...staff, params: dayParams }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('endDay', () => {
  test('ends a running session with a 15-minute grace period and lists who was never called in', async () => {
    prisma.interviewDay.findUnique.mockResolvedValue({ id: 5, vacancyId: 3, day: '2030-10-01', startedAt: new Date('2030-10-01T06:55:00Z') });
    prisma.interviewRound.findMany.mockResolvedValue([
      round(1, '2030-10-01T07:00:00Z', { calledInAt: new Date('2030-10-01T07:00:00Z') }),
      round(2, '2030-10-01T08:00:00Z')
    ]);
    const res = mockRes();
    await interviewController.endDay({ ...staff, params: dayParams }, res);

    const [{ data }] = prisma.interviewDay.updateMany.mock.calls[0];
    expect(data.closesAt - data.endedAt).toBe(15 * 60 * 1000);
    expect(res.json.mock.calls[0][0].notCalledIn).toEqual([{ id: 2, candidateName: 'Candidate 2' }]);
  });

  test('refuses a session that was never started', async () => {
    const res = mockRes();
    await interviewController.endDay({ ...staff, params: dayParams }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe('callIn', () => {
  beforeEach(() => {
    prisma.interviewRound.findUnique.mockResolvedValue(round(1, '2030-10-01T07:00:00Z'));
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
  });

  test('calls a candidate in while the session is running', async () => {
    prisma.interviewDay.findUnique.mockResolvedValue({ id: 5, startedAt: new Date('2030-10-01T06:45:00Z'), endedAt: null });
    const res = mockRes();
    await interviewController.callIn({ ...staff, params: { interviewId: '1' }, body: {} }, res);
    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'Scheduled', calledInAt: null }, data: { calledInAt: expect.any(Date), calledInById: 9 }
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  test('refuses before the session is started', async () => {
    const res = mockRes();
    await interviewController.callIn({ ...staff, params: { interviewId: '1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  test('refuses once the session has ended', async () => {
    prisma.interviewDay.findUnique.mockResolvedValue({
      id: 5, startedAt: new Date('2030-10-01T06:00:00Z'), endedAt: new Date('2030-10-01T06:40:00Z'), closesAt: new Date('2030-10-01T06:55:00Z')
    });
    const res = mockRes();
    await interviewController.callIn({ ...staff, params: { interviewId: '1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe('checkInterviewSessions', () => {
  beforeEach(() => {
    prisma.notification.create.mockResolvedValue({});
    prisma.staffUser.findUnique.mockResolvedValue({ id: 9, email: null });
  });

  test('tells whoever scheduled the day once its session is 30 minutes late', async () => {
    jest.setSystemTime(new Date('2030-10-01T07:31:00Z'));
    prisma.interviewRound.findMany.mockResolvedValue([round(1, '2030-10-01T07:00:00Z')]);
    await checkInterviewSessions.run(new Date());

    expect(prisma.interviewRound.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'Scheduled', scheduledDate: { gte: expect.any(Date), lte: new Date('2030-10-01T07:01:00Z') } }
    }));
    expect(prisma.interviewDay.updateMany).toHaveBeenCalledWith({
      where: { id: 5, startedAt: null, notStartedAlertAt: null }, data: { notStartedAlertAt: expect.any(Date) }
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 9, taskType: 'InterviewSessionNotStarted', taskId: 1 })
    });
  });

  test('stays quiet once the session is started or HR was already told', async () => {
    jest.setSystemTime(new Date('2030-10-01T07:31:00Z'));
    prisma.interviewRound.findMany.mockResolvedValue([round(1, '2030-10-01T07:00:00Z')]);
    prisma.interviewDay.findUnique.mockResolvedValue({ id: 5, startedAt: null, notStartedAlertAt: new Date() });
    await checkInterviewSessions.run(new Date());
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
