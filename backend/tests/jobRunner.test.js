jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const { runJob } = require('../src/utils/jobRunner');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('runJob', () => {
  test('records a successful run against the job key', async () => {
    const result = await runJob('checkVacancyDeadlines', async () => '2 notified');

    expect(result).toEqual({ ok: true, summary: '2 notified' });
    expect(prisma.systemHealth.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'job:checkVacancyDeadlines' },
      update: expect.objectContaining({ consecutiveFailures: 0, alertedAt: null })
    }));
  });

  test('records a failed run with its error, and never throws', async () => {
    const result = await runJob('checkSlaEscalations', async () => { throw new Error('boom'); });

    expect(result.ok).toBe(false);
    expect(prisma.systemHealth.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'job:checkSlaEscalations' },
      update: expect.objectContaining({ lastError: 'boom', consecutiveFailures: { increment: 1 } })
    }));
  });

  test('still reports the job outcome when recording health itself fails', async () => {
    prisma.systemHealth.upsert.mockRejectedValueOnce(new Error('database down'));

    const result = await runJob('cleanupVerificationTokens', async () => 'done');

    expect(result.ok).toBe(true);
  });
});

describe('systemHealthModel upsert retry', () => {
  const systemHealthModel = require('../src/models/systemHealthModel');

  test('retries once when a concurrent first write created the row first', async () => {
    const conflict = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    prisma.systemHealth.upsert.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ key: 'mail' });

    await expect(systemHealthModel.recordSuccess('mail')).resolves.toEqual({ key: 'mail' });
    expect(prisma.systemHealth.upsert).toHaveBeenCalledTimes(2);
  });

  test('does not retry other errors', async () => {
    prisma.systemHealth.upsert.mockRejectedValueOnce(new Error('connection lost'));

    await expect(systemHealthModel.recordFailure('mail', 'x')).rejects.toThrow('connection lost');
    expect(prisma.systemHealth.upsert).toHaveBeenCalledTimes(1);
  });
});
