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

  test('an application left at Offered is finished once its offer ended without a hire', () => {
    for (const status of ['Declined', 'Expired', 'Withdrawn']) {
      expect(purge.blockerFor({ applications: [app('Offered', { status })] })).toBeNull();
    }
    for (const status of ['Recommended', 'Returned', 'Approved']) {
      expect(purge.blockerFor({ applications: [app('Offered', { status })] })).toMatch(/in progress/);
    }
    expect(purge.blockerFor({ applications: [app('Offered')] })).toMatch(/in progress/);
  });

  test('the scheduled purge uses the same rule', async () => {
    prisma.setting.findUnique.mockResolvedValue(null);
    prisma.candidate.findMany.mockResolvedValue([]);
    await purge.purgeExpired(new Date('2026-10-06'));
    const none = prisma.candidate.findMany.mock.calls[0][0].where.applications.none;
    expect(none.OR).toContainEqual({
      OR: expect.arrayContaining([{ status: 'Offered', NOT: { offer: { status: { in: ['Declined', 'Expired', 'Withdrawn'] } } } }])
    });
    expect(none.OR[0].OR[0].status.in).not.toContain('Offered');
  });

  test('the last activity is their latest sign-in or application event', () => {
    const last = purge.lastActivity({
      createdAt: new Date('2024-01-01'), lastLoginAt: new Date('2024-06-01'),
      applications: [{ createdAt: new Date('2024-03-01'), submittedDate: null, rejectedAt: new Date('2025-02-01'), offer: null }]
    });
    expect(last).toEqual(new Date('2025-02-01'));
  });
});

describe('erasing a candidate', () => {
  // Everything the erasure writes, inside its one transaction.
  const many = () => ({ deleteMany: jest.fn().mockResolvedValue({ count: 0 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
  let tx;
  beforeEach(() => {
    tx = {
      workExperience: many(), education: many(), examGrade: many(), certificate: many(), internalProfile: many(),
      verificationToken: many(), candidateNotification: many(), candidateTagging: many(), bulkEmailRecipient: many(),
      applicationDocument: many(), application: many(), interviewRound: many(), shortlistRating: many(), auditLog: many(),
      candidate: { update: jest.fn() }, dataPurgeLog: { create: jest.fn() }
    };
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    prisma.candidate.findUnique.mockResolvedValue({
      id: 9, purgedAt: null, photoUrl: null, internalProfile: null,
      applications: [{
        id: 31, status: 'Rejected', cvUrl: null, coverLetterUrl: null, documents: [], offer: null,
        interviewRounds: [{ scoreSheetUrl: '/api/files/sheet-1.pdf' }, { scoreSheetUrl: null }]
      }]
    });
  });

  test('removes the score sheets and empties the qualification snapshot taken when they applied', async () => {
    const result = await purge.purgeCandidate(9, { reason: 'ErasureRequest' });

    expect(result.purged).toBe(true);
    expect(result.removed.files).toBe(1);
    expect(tx.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { applicationId: { in: [31] } },
      data: expect.objectContaining({ scoreSheetUrl: null, scoreSheetName: null })
    });
    expect(tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { entityType: 'ApplicationSnapshot', entityId: { in: [31] } },
      data: { payload: expect.objectContaining({ erased: true }) }
    });
  });
});
