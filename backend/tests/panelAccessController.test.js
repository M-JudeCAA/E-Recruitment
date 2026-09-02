jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(true) }));

const prisma = require('../src/config/db');
const panelAccessController = require('../src/controllers/panelAccessController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generateLink (regeneration behavior)', () => {
  test('revokes any prior outstanding token before issuing a new one', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, score: null, email: null, name: 'Jane Doe' });
    prisma.panelAccessToken.create.mockResolvedValue({ id: 1, token: 'abc123' });

    const req = { params: { panelMemberId: '4' } };
    const res = mockRes();

    await panelAccessController.generateLink(req, res);

    // Revocation must happen before the new token is created, so there is
    // never a window where both the old and new links are simultaneously valid.
    const revokeCallOrder = prisma.panelAccessToken.updateMany.mock.invocationCallOrder[0];
    const createCallOrder = prisma.panelAccessToken.create.mock.invocationCallOrder[0];
    expect(revokeCallOrder).toBeLessThan(createCallOrder);

    expect(prisma.panelAccessToken.updateMany).toHaveBeenCalledWith({
      where: { panelMemberId: 4, usedAt: null },
      data: { usedAt: expect.any(Date) }
    });
  });

  test('a second regeneration call revokes the link issued by the first call', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, score: null, email: null, name: 'Jane Doe' });
    prisma.panelAccessToken.create
      .mockResolvedValueOnce({ id: 1, token: 'first-token' })
      .mockResolvedValueOnce({ id: 2, token: 'second-token' });

    const req = { params: { panelMemberId: '4' } };

    await panelAccessController.generateLink(req, mockRes());
    await panelAccessController.generateLink(req, mockRes());

    expect(prisma.panelAccessToken.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.panelAccessToken.create).toHaveBeenCalledTimes(2);
  });

  test('still refuses to generate a link once the panelist has already been scored', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, score: 90 });
    const res = mockRes();

    await panelAccessController.generateLink({ params: { panelMemberId: '4' } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.panelAccessToken.create).not.toHaveBeenCalled();
  });
});
