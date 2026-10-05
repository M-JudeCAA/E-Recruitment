jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const handoff = require('../src/services/hrisHandoffService');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.HRIS_HANDOFF_URL;
});

test('retries wait longer each time', () => {
  expect([1, 2, 3, 4].map(handoff.retryDelayMinutes)).toEqual([5, 15, 45, 135]);
  const now = new Date('2026-10-05T12:00:00Z');
  const at = (mins) => new Date(now.getTime() - mins * 60000);
  expect(handoff.dueForRetry({ handoffStatus: 'Pending', handoffAttempts: 2, handoffLastAttemptAt: at(10) }, now)).toBe(false);
  expect(handoff.dueForRetry({ handoffStatus: 'Pending', handoffAttempts: 2, handoffLastAttemptAt: at(16) }, now)).toBe(true);
  expect(handoff.dueForRetry({ handoffStatus: 'Sent', handoffAttempts: 1, handoffLastAttemptAt: at(600) }, now)).toBe(false);
});

test('without an HRIS connection a case is left for HR to pass on by hand', async () => {
  prisma.hire.findUnique.mockResolvedValue({ id: 1, caseRef: 'UCAA/ONB/001/2026', handoffStatus: 'Pending', handoffAttempts: 0 });
  prisma.hire.update.mockResolvedValue({ id: 1, handoffStatus: 'NotConfigured' });
  await handoff.send(1);
  expect(prisma.hire.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { handoffStatus: 'NotConfigured' } });
});

test('after the last attempt the case fails and Directors are alerted', async () => {
  process.env.HRIS_HANDOFF_URL = 'http://hris.invalid/onboarding';
  global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
  prisma.hire.findUnique.mockResolvedValue({ id: 1, caseRef: 'UCAA/ONB/001/2026', handoffStatus: 'Pending', handoffAttempts: handoff.MAX_ATTEMPTS - 1, package: {} });
  prisma.hire.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
  prisma.staffUser.findMany.mockResolvedValue([{ id: 9 }]);
  prisma.staffUser.findUnique.mockResolvedValue(null);
  const result = await handoff.send(1);
  expect(result.handoffStatus).toBe('Failed');
  expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recipientId: 9, taskType: 'SystemHealthAlert' }) });
});
