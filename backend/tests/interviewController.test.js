jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const interviewController = require('../src/controllers/interviewController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('schedule', () => {
  test('rejects an invalid application id', async () => {
    const req = { params: { applicationId: 'abc' }, body: {} };
    const res = mockRes();

    await interviewController.schedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('returns 404 when the application does not exist', async () => {
    prisma.application.findUnique.mockResolvedValue(null);
    const req = { params: { applicationId: '1' }, body: {} };
    const res = mockRes();

    await interviewController.schedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test.each(['Draft', 'Submitted', 'UnderReview', 'Offered', 'Rejected', 'Withdrawn'])(
    'refuses to schedule an interview for an application at status %s', async (status) => {
      prisma.application.findUnique.mockResolvedValue({ id: 1, status, offer: null });
      const req = { params: { applicationId: '1' }, body: {} };
      const res = mockRes();

      await interviewController.schedule(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(prisma.interviewRound.create).not.toHaveBeenCalled();
    }
  );

  test('refuses to schedule an interview for an application that already has an offer', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'Interviewed', offer: { id: 9 } });
    const req = { params: { applicationId: '1' }, body: {} };
    const res = mockRes();

    await interviewController.schedule(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('sets the application to InterviewScheduled and notifies the candidate of the date', async () => {
    prisma.application.findUnique
      .mockResolvedValueOnce({ id: 1, status: 'Shortlisted', offer: null })
      .mockResolvedValueOnce({ id: 1, candidateId: 5, vacancy: { title: 'Air Traffic Controller' } });
    prisma.interviewRound.count.mockResolvedValue(0);
    prisma.interviewRound.create.mockResolvedValue({ id: 1, applicationId: 1, roundNumber: 1, scheduledDate: new Date('2026-10-01T10:00:00Z'), mode: 'Virtual' });
    prisma.application.update.mockResolvedValue({ id: 1, candidateId: 5, vacancy: { title: 'Air Traffic Controller' } });

    const req = { params: { applicationId: '1' }, body: { scheduledDate: '2026-10-01T10:00:00Z', mode: 'Virtual', panelMembers: [] } };
    const res = mockRes();

    await interviewController.schedule(req, res);

    expect(prisma.application.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: { status: 'InterviewScheduled' }
    }));
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'InterviewScheduled' })
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('finalizeRecommendation', () => {
  test('rejects an invalid interview round id', async () => {
    const req = { params: { interviewId: 'abc' }, body: { recommendation: 'Shortlist' } };
    const res = mockRes();

    await interviewController.finalizeRecommendation(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 422 when no panel member has scored yet', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: null }]);
    const req = { params: { interviewId: '1' }, body: { recommendation: 'Shortlist' } };
    const res = mockRes();

    await interviewController.finalizeRecommendation(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  test('returns 409 when this round already has a finalized recommendation (double-finalize/race)', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } };
    const res = mockRes();

    await interviewController.finalizeRecommendation(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('a "Shortlist" recommendation moves the application to Interviewed, not Rejected', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findUnique.mockResolvedValue({ id: 1, applicationId: 1, recommendation: 'Shortlist' });
    const req = { params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } };
    const res = mockRes();

    await interviewController.finalizeRecommendation(req, res);

    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { id: 1, recommendation: null }, data: { recommendation: 'Shortlist', conductedById: 9 }
    });
    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'Interviewed' } });
  });

  // Previously a "Reject" recommendation only wrote the label onto the
  // InterviewRound - the application itself stayed at "Interviewed"
  // forever with no formal resolution and recommendOffer's old (now
  // tightened) check didn't care which recommendation string was present,
  // so a rejected candidate could still be recommended for an offer.
  test('a "Reject" recommendation rejects the application and notifies the candidate, instead of leaving it at Interviewed', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 40 }]);
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findUnique.mockResolvedValue({ id: 1, applicationId: 1, recommendation: 'Reject' });
    prisma.application.update.mockResolvedValue({ id: 1, candidateId: 5, vacancy: { title: 'Air Traffic Controller' } });
    const req = { params: { interviewId: '1' }, body: { recommendation: 'Reject' }, user: { id: 9 } };
    const res = mockRes();

    await interviewController.finalizeRecommendation(req, res);

    expect(prisma.application.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'Rejected', rejectedById: 9 })
    }));
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'ApplicationRejected' })
    }));
  });
});

describe('recordPanelScore', () => {
  test('rejects an invalid panel member id', async () => {
    const req = { params: { panelMemberId: 'abc' }, body: { score: 80 } };
    const res = mockRes();

    await interviewController.recordPanelScore(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test.each([-1, 101, NaN, 'not-a-number'])('rejects an out-of-range/non-numeric score (%p)', async (score) => {
    const req = { params: { panelMemberId: '1' }, body: { score } };
    const res = mockRes();

    await interviewController.recordPanelScore(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when the panel member does not exist', async () => {
    prisma.panelMember.findUnique.mockResolvedValue(null);
    const req = { params: { panelMemberId: '99' }, body: { score: 80 } };
    const res = mockRes();

    await interviewController.recordPanelScore(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('records a valid score', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 1, interviewRoundId: 5 });
    prisma.panelMember.update.mockResolvedValue({ id: 1, score: 80, interviewRoundId: 5 });
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 80 }]);
    const req = { params: { panelMemberId: '1' }, body: { score: 80, comments: 'Good' }, user: { id: 9 } };
    const res = mockRes();

    await interviewController.recordPanelScore(req, res);

    expect(prisma.panelMember.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ score: 80 })
    }));
    expect(res.json).toHaveBeenCalled();
  });
});
