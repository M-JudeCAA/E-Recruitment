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

describe('submitByToken / recuseByToken (panelist self-service)', () => {
  const future = new Date(Date.now() + 86400000);
  const tokenRecord = (roundOverrides = {}, memberOverrides = {}) => ({
    id: 1, token: 'tok', usedAt: null, expiresAt: future, panelMemberId: 4,
    panelMember: {
      id: 4, name: 'Ann', score: null, recusedAt: null, interviewRoundId: 10, ...memberOverrides,
      interviewRound: {
        id: 10, status: 'Scheduled', criteria: null, roundNumber: 1,
        application: { candidate: { fullName: 'Jane' }, vacancy: { jobRef: 'R1', title: 'ATC' } },
        ...roundOverrides
      }
    }
  });

  test('an out-of-range score is refused WITHOUT burning the single-use link', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue(tokenRecord());
    const res = mockRes();
    await panelAccessController.submitByToken({ params: { token: 'tok' }, body: { score: 500 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.panelAccessToken.update).not.toHaveBeenCalled();
    expect(prisma.panelMember.update).not.toHaveBeenCalled();
  });

  test('a rubric round computes the score from the ratings and marks it self-submitted', async () => {
    const criteria = [{ id: 'c_aaaa1111', name: 'Technical', weight: 1 }];
    prisma.panelAccessToken.findUnique.mockResolvedValue(tokenRecord({ criteria }));
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, interviewRoundId: 10 });
    prisma.panelMember.findMany.mockResolvedValue([{ id: 4, score: 80 }]);
    prisma.interviewRound.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await panelAccessController.submitByToken({ params: { token: 'tok' }, body: { criterionScores: { c_aaaa1111: 4 }, comments: ' Solid ' } }, res);
    expect(prisma.panelMember.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: expect.objectContaining({ score: 80, criterionScores: { c_aaaa1111: 4 }, comments: 'Solid', selfSubmitted: true })
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ score: 80 }));
  });

  test('the last panel score in tells whoever scheduled the round that it is ready to finalize', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue(tokenRecord());
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, interviewRoundId: 10 });
    prisma.panelMember.findMany.mockResolvedValue([{ id: 4, score: 75 }]);
    prisma.interviewRound.findUnique.mockResolvedValue({
      id: 10, roundNumber: 1, scheduledById: 9, recommendation: null, score: 75, scheduledDate: new Date(), durationMinutes: 60,
      application: { candidate: { fullName: 'Jane' }, vacancy: { jobRef: 'R1', title: 'ATC', createdById: 2 } },
      panelMembers: [{ id: 4, score: 75 }]
    });
    prisma.staffUser.findUnique.mockResolvedValue({ id: 9, email: null });
    const res = mockRes();
    await panelAccessController.submitByToken({ params: { token: 'tok' }, body: { score: 75 } }, res);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 9, taskType: 'InterviewReadyToFinalize', taskId: 10 })
    });
  });

  test('a link for a round that has been cancelled no longer works', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue(tokenRecord({ status: 'Cancelled' }));
    const res = mockRes();
    await panelAccessController.viewByToken({ params: { token: 'tok' } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('did not go ahead') });
  });

  test('the panelist can stand down with a reason, which uses up the link', async () => {
    prisma.panelAccessToken.findUnique.mockResolvedValue(tokenRecord());
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, interviewRoundId: 10 });
    prisma.panelMember.findMany.mockResolvedValue([]);
    prisma.interviewRound.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await panelAccessController.recuseByToken({ params: { token: 'tok' }, body: { reason: 'She is my cousin' } }, res);
    expect(prisma.panelAccessToken.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { usedAt: expect.any(Date) } });
    expect(prisma.panelMember.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: expect.objectContaining({ recusalReason: expect.stringContaining('cousin'), recusedAt: expect.any(Date) })
    });
  });
});
