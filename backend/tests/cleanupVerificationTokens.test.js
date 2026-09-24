jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const { run, RETENTION_DAYS } = require('../scripts/cleanupVerificationTokens');

beforeEach(() => {
  jest.clearAllMocks();
});

test('deletes tokens used or expired more than the retention period ago, leaving pending registrations alone', async () => {
  prisma.verificationToken.deleteMany.mockResolvedValue({ count: 12 });
  const now = new Date('2026-09-24T12:00:00Z');
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const summary = await run(now);

  expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
    where: {
      pendingRegistrationId: null,
      OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }]
    }
  });
  expect(summary).toMatch(/12 used or expired token/);
});
