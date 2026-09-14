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
  test('sets the application to InterviewScheduled and notifies the candidate of the date', async () => {
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
  test('returns 422 when no panel member has scored yet', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: null }]);
    const req = { params: { interviewId: '1' }, body: { recommendation: 'Shortlist' } };
    const res = mockRes();

    await interviewController.finalizeRecommendation(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.interviewRound.update).not.toHaveBeenCalled();
  });

  test('a "Shortlist" recommendation moves the application to Interviewed, not Rejected', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
    prisma.interviewRound.update.mockResolvedValue({ id: 1, applicationId: 1, recommendation: 'Shortlist' });
    const req = { params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } };
    const res = mockRes();

    await interviewController.finalizeRecommendation(req, res);

    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'Interviewed' } });
  });

  // Previously a "Reject" recommendation only wrote the label onto the
  // InterviewRound - the application itself stayed at "Interviewed"
  // forever with no formal resolution and recommendOffer's old (now
  // tightened) check didn't care which recommendation string was present,
  // so a rejected candidate could still be recommended for an offer.
  test('a "Reject" recommendation rejects the application and notifies the candidate, instead of leaving it at Interviewed', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 40 }]);
    prisma.interviewRound.update.mockResolvedValue({ id: 1, applicationId: 1, recommendation: 'Reject' });
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
