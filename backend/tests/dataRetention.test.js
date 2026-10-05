jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const settings = require('../src/services/settingsService');
const purge = require('../src/services/candidatePurgeService');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ACCESS_LOG_RETENTION_DAYS;
});

describe('settings', () => {
  test('defaults until set; a value outside the limits is refused and never read', async () => {
    prisma.setting.findUnique.mockResolvedValue(null);
    expect(await settings.get('candidateRetentionMonths')).toBe(24);
    process.env.ACCESS_LOG_RETENTION_DAYS = '400';
    expect(await settings.get('accessLogRetentionDays')).toBe(400);
    await expect(settings.set('candidateRetentionMonths', 2, 1)).rejects.toMatchObject({ status: 400 });
    await expect(settings.set('candidateRetentionMonths', '12.5', 1)).rejects.toMatchObject({ status: 400 });
    await expect(settings.set('nope', 12, 1)).rejects.toMatchObject({ status: 404 });
    prisma.setting.findUnique.mockResolvedValue({ key: 'candidateRetentionMonths', value: 3 }); // stored before a limit changed
    expect(await settings.get('candidateRetentionMonths')).toBe(24);
  });

  test('saves a valid value and says what it was', async () => {
    prisma.setting.findUnique.mockResolvedValue(null);
    expect(await settings.set('candidateRetentionMonths', '36', 7)).toEqual({ before: 24, after: 36 });
    expect(prisma.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { key: 'candidateRetentionMonths', value: 36, updatedById: 7 } }));
  });
});

describe('who can be erased', () => {
  const app = (status, offer = null) => ({ status, offer, createdAt: new Date('2025-01-01') });
  test('never a hire, nor anyone with an application still in progress', () => {
    expect(purge.blockerFor({ applications: [app('Offered', { status: 'Accepted' })] })).toMatch(/hired/);
    expect(purge.blockerFor({ applications: [app('Rejected'), app('Shortlisted')] })).toMatch(/in progress/);
    expect(purge.blockerFor({ applications: [app('Rejected'), app('Withdrawn'), app('Draft')] })).toBeNull();
  });

  test('the last activity is their latest sign-in or application event', () => {
    const last = purge.lastActivity({
      createdAt: new Date('2024-01-01'), lastLoginAt: new Date('2024-06-01'),
      applications: [{ createdAt: new Date('2024-03-01'), submittedDate: null, rejectedAt: new Date('2025-02-01'), offer: null }]
    });
    expect(last).toEqual(new Date('2025-02-01'));
  });
});
