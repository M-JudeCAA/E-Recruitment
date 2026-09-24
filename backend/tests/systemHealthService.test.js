jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const systemHealthService = require('../src/services/systemHealthService');

const NOW = new Date('2026-09-24T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const healthyJobs = () => systemHealthService.JOBS.map(({ name }) => ({
  key: `job:${name}`, lastSuccessAt: hoursAgo(1), lastFailureAt: null, consecutiveFailures: 0
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildStatus', () => {
  test('reports no warnings when every job ran recently and email works', () => {
    const rows = [...healthyJobs(), { key: 'mail', lastSuccessAt: hoursAgo(2), consecutiveFailures: 0 }];
    const status = systemHealthService.buildStatus(rows, NOW);

    expect(status.warnings).toEqual([]);
    expect(status.jobs.every((j) => j.status === 'ok')).toBe(true);
    expect(status.mail.status).toBe('ok');
  });

  test('warns that scheduled maintenance is not running when no job has ever run', () => {
    const status = systemHealthService.buildStatus([], NOW);

    expect(status.jobs.every((j) => j.status === 'never')).toBe(true);
    expect(status.warnings).toHaveLength(1);
    expect(status.warnings[0]).toMatch(/Scheduled maintenance has not run/);
    expect(status.warnings[0]).toMatch(/npm run jobs/);
    expect(status.mail.status).toBe('unknown');
  });

  test('treats a job as stale once its last success is older than the threshold', () => {
    const rows = healthyJobs();
    rows[0].lastSuccessAt = hoursAgo(systemHealthService.STALE_AFTER_HOURS + 1);
    const status = systemHealthService.buildStatus(rows, NOW);

    expect(status.jobs[0].status).toBe('stale');
    expect(status.jobs.slice(1).every((j) => j.status === 'ok')).toBe(true);
    expect(status.warnings[0]).toMatch(/SLA escalation check/);
  });

  test('reports a job whose latest run failed as failing, separately from stale jobs', () => {
    const rows = healthyJobs();
    rows[1].consecutiveFailures = 2;
    rows[1].lastFailureAt = hoursAgo(0.5);
    const status = systemHealthService.buildStatus(rows, NOW);

    expect(status.jobs[1].status).toBe('failing');
    expect(status.warnings).toEqual([expect.stringMatching(/Scheduled maintenance is failing \(vacancy deadline notices\)/)]);
  });

  test('warns that emails are not being sent after a failed attempt, without exposing the error text', () => {
    const rows = [...healthyJobs(), {
      key: 'mail', lastSuccessAt: hoursAgo(5), lastFailureAt: hoursAgo(1), consecutiveFailures: 4,
      lastError: 'connect ECONNREFUSED 10.0.0.5:587'
    }];
    const status = systemHealthService.buildStatus(rows, NOW);

    expect(status.mail.status).toBe('failing');
    expect(status.warnings).toEqual([expect.stringMatching(/Emails are not being sent\. The last 4 attempts failed/)]);
    expect(JSON.stringify(status)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });
});

describe('checkAndAlert', () => {
  test('alerts every Director in-app once email has failed repeatedly', async () => {
    prisma.systemHealth.findMany.mockResolvedValue([
      ...healthyJobs(), { key: 'mail', lastFailureAt: hoursAgo(0.1), consecutiveFailures: 3 }
    ]);
    prisma.systemHealth.updateMany.mockResolvedValue({ count: 1 });
    prisma.staffUser.findMany.mockResolvedValue([{ id: 40 }, { id: 41 }]);

    await systemHealthService.checkAndAlert(NOW);

    expect(prisma.systemHealth.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ key: 'mail' }), data: { alertedAt: NOW }
    }));
    expect(prisma.staffUser.findMany).toHaveBeenCalledWith({ where: { role: 'Director' }, select: { id: true } });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 40, channel: 'InApp', taskType: 'SystemHealthAlert', taskId: 0 })
    });
  });

  test('does not alert again while an alert for the same problem was sent within the last day', async () => {
    prisma.systemHealth.findMany.mockResolvedValue([
      ...healthyJobs(), { key: 'mail', lastFailureAt: hoursAgo(0.1), consecutiveFailures: 5 }
    ]);
    prisma.systemHealth.updateMany.mockResolvedValue({ count: 0 });

    await systemHealthService.checkAndAlert(NOW);

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('does not alert Directors about a single failed email', async () => {
    prisma.systemHealth.findMany.mockResolvedValue([
      ...healthyJobs(), { key: 'mail', lastFailureAt: hoursAgo(0.1), consecutiveFailures: 1 }
    ]);

    const status = await systemHealthService.checkAndAlert(NOW);

    expect(status.mail.status).toBe('failing');
    expect(prisma.systemHealth.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('alerts about a job that has never run, creating its health row so the alert is not repeated', async () => {
    const rows = healthyJobs().filter((r) => r.key !== 'job:cleanupVerificationTokens');
    prisma.systemHealth.findMany.mockResolvedValue(rows);
    prisma.systemHealth.updateMany.mockResolvedValue({ count: 1 });
    prisma.staffUser.findMany.mockResolvedValue([{ id: 40 }]);

    await systemHealthService.checkAndAlert(NOW);

    expect(prisma.systemHealth.upsert).toHaveBeenCalledWith({
      where: { key: 'job:cleanupVerificationTokens' }, create: { key: 'job:cleanupVerificationTokens' }, update: {}
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ message: expect.stringMatching(/has not run in the last 3 hours/) })
    });
  });
});
