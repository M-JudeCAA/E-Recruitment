jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const controller = require('../src/controllers/candidateInterviewController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn();
  return res;
}

function round(overrides = {}) {
  return {
    id: 1, applicationId: 2, roundNumber: 1, status: 'Scheduled', scheduledDate: new Date(Date.now() + 48 * 3600000),
    durationMinutes: 60, mode: 'In-person', location: 'Room B', rescheduleCount: 0, scheduledById: 9,
    score: 70, recommendation: null, internalNotes: 'staff only',
    application: {
      candidateId: 5, candidate: { fullName: 'Jane Doe' },
      vacancy: { jobRef: 'R1', title: 'Air Traffic Controller', createdById: 2 }
    },
    panelMembers: [],
    ...overrides
  };
}

beforeEach(() => jest.clearAllMocks());

describe('respond', () => {
  test("another candidate's interview is a 404", async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(round({ application: { ...round().application, candidateId: 99 } }));
    const res = mockRes();
    await controller.respond({ params: { id: '1' }, body: { response: 'Confirmed' }, user: { id: 5 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.interviewRound.update).not.toHaveBeenCalled();
  });

  test('confirming records the answer and returns only candidate-safe fields', async () => {
    prisma.interviewRound.findUnique
      .mockResolvedValueOnce(round())
      .mockResolvedValueOnce({ ...round(), candidateResponse: 'Confirmed' });
    const res = mockRes();
    await controller.respond({ params: { id: '1' }, body: { response: 'Confirmed' }, user: { id: 5 } }, res);
    expect(prisma.interviewRound.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ candidateResponse: 'Confirmed', candidateRespondedAt: expect.any(Date) })
    });
    const body = res.json.mock.calls[0][0];
    expect(body.candidateResponse).toBe('Confirmed');
    expect(body).not.toHaveProperty('score');
    expect(body).not.toHaveProperty('internalNotes');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('asking for another time needs a note, and tells whoever scheduled it', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(round());
    const res1 = mockRes();
    await controller.respond({ params: { id: '1' }, body: { response: 'RescheduleRequested', note: '' }, user: { id: 5 } }, res1);
    expect(res1.status).toHaveBeenCalledWith(400);

    prisma.staffUser.findUnique.mockResolvedValue({ id: 9, email: null });
    const res2 = mockRes();
    await controller.respond({
      params: { id: '1' }, body: { response: 'RescheduleRequested', note: 'I am travelling that week, any day after the 10th' }, user: { id: 5 }
    }, res2);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 9, taskType: 'InterviewRescheduleRequested', taskId: 1, message: expect.stringContaining('travelling') })
    });
  });

  test('cannot respond once the interview has started or is no longer scheduled', async () => {
    prisma.interviewRound.findUnique.mockResolvedValueOnce(round({ scheduledDate: new Date(Date.now() - 60000) }));
    const res1 = mockRes();
    await controller.respond({ params: { id: '1' }, body: { response: 'Confirmed' }, user: { id: 5 } }, res1);
    expect(res1.status).toHaveBeenCalledWith(422);

    prisma.interviewRound.findUnique.mockResolvedValueOnce(round({ status: 'Cancelled' }));
    const res2 = mockRes();
    await controller.respond({ params: { id: '1' }, body: { response: 'Confirmed' }, user: { id: 5 } }, res2);
    expect(res2.status).toHaveBeenCalledWith(409);
  });
});

describe('calendarFile', () => {
  test('sends an .ics for the candidate\'s own scheduled interview', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(round());
    const res = mockRes();
    await controller.calendarFile({ params: { id: '1' }, user: { id: 5 } }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/calendar; charset=utf-8');
    expect(res.send.mock.calls[0][0]).toContain('SUMMARY:Interview: Air Traffic Controller (UCAA)');
  });

  test('refuses a round with no time', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(round({ scheduledDate: null }));
    const res = mockRes();
    await controller.calendarFile({ params: { id: '1' }, user: { id: 5 } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
