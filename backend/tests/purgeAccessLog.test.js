jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const { run, retentionDays, DEFAULT_RETENTION_DAYS } = require('../scripts/purgeAccessLog');

const DAY_MS = 24 * 60 * 60 * 1000;
const saved = process.env.ACCESS_LOG_RETENTION_DAYS;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ACCESS_LOG_RETENTION_DAYS;
  prisma.dataAccessLog.deleteMany.mockResolvedValue({ count: 4 });
});

afterAll(() => {
  if (saved === undefined) delete process.env.ACCESS_LOG_RETENTION_DAYS;
  else process.env.ACCESS_LOG_RETENTION_DAYS = saved;
});

test('deletes access records older than the default two years', async () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const summary = await run(now);
  expect(DEFAULT_RETENTION_DAYS).toBe(730);
  expect(prisma.dataAccessLog.deleteMany).toHaveBeenCalledWith({
    where: { at: { lt: new Date(now.getTime() - 730 * DAY_MS) } }
  });
  expect(summary).toMatch(/4 record\(s\) older than 730 days removed/);
});

test('uses ACCESS_LOG_RETENTION_DAYS when set', async () => {
  process.env.ACCESS_LOG_RETENTION_DAYS = '365';
  const now = new Date('2026-10-05T12:00:00Z');
  await run(now);
  expect(prisma.dataAccessLog.deleteMany).toHaveBeenCalledWith({
    where: { at: { lt: new Date(now.getTime() - 365 * DAY_MS) } }
  });
});

test.each(['3', '0', '-30', 'two years', '400.5'])('refuses a retention of "%s" days rather than wiping the log', async (value) => {
  expect(() => retentionDays({ ACCESS_LOG_RETENTION_DAYS: value })).toThrow(/at least 90/);
  process.env.ACCESS_LOG_RETENTION_DAYS = value;
  await expect(run()).rejects.toThrow(/ACCESS_LOG_RETENTION_DAYS/);
  expect(prisma.dataAccessLog.deleteMany).not.toHaveBeenCalled();
});
