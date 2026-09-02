jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const panelAccessService = require('../src/services/panelAccessService');

beforeEach(() => {
  jest.clearAllMocks();
});

function futureDate(days) { return new Date(Date.now() + days * 24 * 60 * 60 * 1000); }
function pastDate(days) { return new Date(Date.now() - days * 24 * 60 * 60 * 1000); }

describe('validateForView', () => {
  test('rejects a token that does not exist', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue(null);
    await expect(panelAccessService.validateForView('nope')).rejects.toThrow(/Invalid access link/);
  });

  test('rejects a token that has already been used', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue({
      id: 1, usedAt: new Date(), expiresAt: futureDate(1),
      panelMember: { score: null }
    });
    await expect(panelAccessService.validateForView('t')).rejects.toThrow(/already been used/);
  });

  test('rejects an expired token even if unused', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue({
      id: 1, usedAt: null, expiresAt: pastDate(1),
      panelMember: { score: null }
    });
    await expect(panelAccessService.validateForView('t')).rejects.toThrow(/expired/);
  });

  test('rejects if the panelist has already been scored some other way (e.g. proxy entry)', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue({
      id: 1, usedAt: null, expiresAt: futureDate(1),
      panelMember: { score: 85 }
    });
    await expect(panelAccessService.validateForView('t')).rejects.toThrow(/already been recorded/);
  });

  test('accepts a valid, unused, unexpired token for an unscored panelist', async () => {
    const record = {
      id: 1, usedAt: null, expiresAt: futureDate(1),
      panelMember: { score: null }
    };
    prisma.panelAccessToken.findUnique.mockResolvedValue(record);
    await expect(panelAccessService.validateForView('t')).resolves.toBe(record);
  });
});

describe('consumeForSubmit', () => {
  test('marks the token used on successful submission, preventing replay', async () => {
    const record = {
      id: 7, usedAt: null, expiresAt: futureDate(1),
      panelMember: { score: null }, panelMemberId: 3
    };
    prisma.panelAccessToken.findUnique.mockResolvedValue(record);

    await panelAccessService.consumeForSubmit('t');

    expect(prisma.panelAccessToken.update).toHaveBeenCalledWith({
      where: { id: 7 }, data: { usedAt: expect.any(Date) }
    });
  });

  test('does not mark the token used if validation fails first', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue({
      id: 7, usedAt: new Date(), expiresAt: futureDate(1),
      panelMember: { score: null }
    });

    await expect(panelAccessService.consumeForSubmit('t')).rejects.toThrow();
    expect(prisma.panelAccessToken.update).not.toHaveBeenCalled();
  });
});

describe('revokeOutstandingTokens', () => {
  test('marks only unused tokens for that panelist as used', async () => {
    await panelAccessService.revokeOutstandingTokens(5);
    expect(prisma.panelAccessToken.updateMany).toHaveBeenCalledWith({
      where: { panelMemberId: 5, usedAt: null },
      data: { usedAt: expect.any(Date) }
    });
  });
});
