jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/services/candidateNotificationService', () => ({ notifyCandidate: jest.fn().mockResolvedValue() }));

const prisma = require('../src/config/db');
const { notifyCandidate } = require('../src/services/candidateNotificationService');
const { run, dueNow } = require('../scripts/sendDiscrepancyReminders');

// Kampala is UTC+3: 09:00 there on 5 November is 06:00Z.
const AT_9AM = new Date('2026-11-05T06:00:00Z');
const profile = (extra = {}) => ({ candidateId: 4, verifiedDate: new Date('2026-11-03T10:00:00Z'), discrepancyReminders: 0, discrepancyRemindedAt: null, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APP_TIMEZONE = 'Africa/Kampala';
  prisma.internalProfile.updateMany.mockResolvedValue({ count: 1 });
});

test('reminds a candidate whose flagged details are still not corrected, once a day', async () => {
  prisma.internalProfile.findMany.mockResolvedValue([profile({ discrepancyReminders: 1, discrepancyRemindedAt: new Date('2026-11-04T06:00:00Z') })]);

  await run(AT_9AM);

  expect(prisma.internalProfile.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({
    verificationStatus: 'Discrepancy_Flagged', discrepancyReminders: { lt: 7 }
  }));
  // Claimed only if nothing else has moved it on.
  expect(prisma.internalProfile.updateMany).toHaveBeenCalledWith({
    where: { candidateId: 4, verificationStatus: 'Discrepancy_Flagged', discrepancyReminders: 1 },
    data: { discrepancyReminders: 2, discrepancyRemindedAt: AT_9AM }
  });
  expect(notifyCandidate).toHaveBeenCalledWith(4, 'EmploymentDiscrepancy', expect.stringContaining('2 days ago'),
    { subject: 'Reminder: your UCAA employment details need correcting' });
});

test('the seventh is the last', async () => {
  prisma.internalProfile.findMany.mockResolvedValue([profile({ discrepancyReminders: 6, discrepancyRemindedAt: new Date('2026-11-04T06:00:00Z') })]);
  await run(AT_9AM);
  expect(notifyCandidate).toHaveBeenCalledWith(4, 'EmploymentDiscrepancy', expect.stringContaining('This is the last reminder.'), expect.anything());
});

test('not twice in a day, not on the day it was flagged, not before 08:00', async () => {
  prisma.internalProfile.findMany.mockResolvedValue([
    profile({ candidateId: 1, discrepancyReminders: 1, discrepancyRemindedAt: new Date('2026-11-05T05:30:00Z') }), // 08:30 today
    profile({ candidateId: 2, verifiedDate: new Date('2026-11-05T05:10:00Z') }) // flagged 08:10 today
  ]);
  expect(await dueNow(AT_9AM)).toEqual([]);

  prisma.internalProfile.findMany.mockClear();
  expect(await dueNow(new Date('2026-11-05T04:00:00Z'))).toEqual([]); // 07:00 Kampala
  expect(prisma.internalProfile.findMany).not.toHaveBeenCalled();
});

test('nothing goes when another run (or a decision) got there first', async () => {
  prisma.internalProfile.findMany.mockResolvedValue([profile()]);
  prisma.internalProfile.updateMany.mockResolvedValue({ count: 0 });
  await run(AT_9AM);
  expect(notifyCandidate).not.toHaveBeenCalled();
});
