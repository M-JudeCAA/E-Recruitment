jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) }));

const prisma = require('../src/config/db');
const offerService = require('../src/services/offerService');
const offerController = require('../src/controllers/offerController');
const candidateController = require('../src/controllers/candidateController');
const { run: runExpireOffers } = require('../scripts/expireOffers');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const TERMS = {
  salaryAmount: 4500000, employmentCategory: 'FullTime', startDate: '2099-01-15', conditions: ['  Medical fitness ', ''], responseDays: 7
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'c@example.test' });
  prisma.staffUser.findUnique.mockResolvedValue({ id: 5, email: null });
});

describe('offerService.parseTerms', () => {
  test('fills in defaults and cleans the conditions', () => {
    expect(offerService.parseTerms(TERMS)).toMatchObject({
      salaryAmount: 4500000, salaryCurrency: 'UGX', salaryPeriod: 'Monthly', employmentCategory: 'FullTime',
      contractMonths: null, conditions: ['Medical fitness'], responseDays: 7, allowances: null, dutyStation: null
    });
  });

  test.each([
    [{ salaryAmount: 0 }, /salary/],
    [{ employmentCategory: 'Casual' }, /employment category/],
    [{ employmentCategory: 'Contract' }, /contract length/],
    [{ startDate: '2000-01-01' }, /past/],
    [{ startDate: 'soon' }, /start date/],
    [{ responseDays: 1 }, /between 3 and 30 days/],
    [{ salaryCurrency: 'shillings' }, /three-letter/]
  ])('rejects %j', (override, message) => {
    expect(() => offerService.parseTerms({ ...TERMS, ...override })).toThrow(message);
  });

  test('requires a contract length for a contract post', () => {
    expect(offerService.parseTerms({ ...TERMS, employmentCategory: 'Contract', contractMonths: 24 }).contractMonths).toBe(24);
  });
});

describe('offerService.toCandidateOffer', () => {
  test('hides an offer that has not been issued', () => {
    expect(offerService.toCandidateOffer({ id: 1, status: 'Recommended', approvedDate: null })).toBeNull();
    expect(offerService.toCandidateOffer({ id: 1, status: 'Returned', approvedDate: null, returnReason: 'x' })).toBeNull();
  });

  test('shows only the terms of an issued offer', () => {
    const shown = offerService.toCandidateOffer({
      id: 1, status: 'Approved', approvedDate: new Date(), responseDeadline: new Date(), salaryAmount: 10, conditions: null,
      recommendedById: 5, approvedById: 6, meritRankAtOffer: 2, interviewScoreAtOffer: 80, returnReason: 'x', withdrawalReason: 'internal'
    });
    expect(shown).toMatchObject({ id: 1, status: 'Approved', salaryAmount: 10, conditions: [], withdrawalReason: null });
    for (const hidden of ['recommendedById', 'approvedById', 'meritRankAtOffer', 'interviewScoreAtOffer', 'returnReason']) {
      expect(shown[hidden]).toBeUndefined();
    }
  });
});

describe('candidateController.myApplications and offers', () => {
  test('an application whose offer is only recommended still reads as Interviewed, with no offer', async () => {
    prisma.application.findMany.mockResolvedValue([{
      id: 1, status: 'Offered', rank: 2, listStatus: null, meritRank: 1, meritListStatus: 'Primary', meritStatus: 'Approved',
      committeeRank: 3, committeeBand: 'Majority', committeeScore: 71.5, committeeAgreement: 0.8,
      vacancy: { id: 3, title: 'ATC' }, interviewRounds: [],
      offer: { id: 9, status: 'Recommended', approvedDate: null, salaryAmount: 1 }
    }]);
    const res = mockRes();
    await candidateController.myApplications({ user: { id: 7 } }, res);
    const [app] = res.json.mock.calls[0][0];
    expect(app.status).toBe('Interviewed');
    expect(app.offer).toBeNull();
    expect(app.meritListStatus).toBeUndefined();
    expect(app.rank).toBeUndefined();
    // The shortlisting committee's view of them is HR's too.
    for (const hidden of ['committeeRank', 'committeeBand', 'committeeScore', 'committeeAgreement']) expect(app[hidden]).toBeUndefined();
  });
});

describe('return and revise', () => {
  const offer = (overrides = {}) => ({
    id: 20, status: 'Recommended', recommendedById: 5, applicationId: 44,
    application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3, jobRef: 'REF/1', title: 'ATC', positionsRequired: 1 } },
    ...overrides
  });

  test('an approver returns an offer with a reason, and its recommender is told', async () => {
    prisma.offer.findUnique.mockResolvedValue(offer());
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();

    await offerController.returnForRevision({ params: { offerId: '20' }, body: { reason: 'Salary is above the scale' }, user: { id: 6 } }, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Recommended' },
      data: { status: 'Returned', returnedAt: expect.any(Date), returnedById: 6, returnReason: 'Salary is above the scale' }
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recipientId: 5, taskType: 'OfferReturned', taskId: 20, message: expect.stringMatching(/returned for revision: Salary is above the scale/)
    }) });
  });

  test('returning needs a reason', async () => {
    prisma.offer.findUnique.mockResolvedValue(offer());
    const res = mockRes();
    await offerController.returnForRevision({ params: { offerId: '20' }, body: {}, user: { id: 6 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  test('revising a returned offer resubmits it with the reviser as recommender', async () => {
    prisma.offer.findUnique.mockResolvedValueOnce(offer({ status: 'Returned' })).mockResolvedValueOnce(offer());
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();

    await offerController.revise({ params: { offerId: '20' }, body: TERMS, user: { id: 8 } }, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Returned' },
      data: expect.objectContaining({ status: 'Recommended', recommendedById: 8, recommendedDate: expect.any(Date), salaryAmount: 4500000 })
    });
    expect(res.json).toHaveBeenCalled();
  });

  test('an issued offer can no longer be revised', async () => {
    prisma.offer.findUnique.mockResolvedValue(offer({ status: 'Approved' }));
    const res = mockRes();
    await offerController.revise({ params: { offerId: '20' }, body: TERMS, user: { id: 8 } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('an offer without terms cannot be approved', async () => {
    prisma.offer.findUnique.mockResolvedValue(offer());
    const res = mockRes();
    await offerController.approve({ params: { offerId: '20' }, user: { id: 6 } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/no terms yet/) });
  });

  test('an offer cannot be approved once every position is filled', async () => {
    prisma.offer.findUnique.mockResolvedValue(offer({ salaryAmount: 1, startDate: new Date(), employmentCategory: 'FullTime' }));
    prisma.offer.count.mockResolvedValue(1);
    const res = mockRes();
    await offerController.approve({ params: { offerId: '20' }, user: { id: 6 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });
});

describe('candidate response deadline', () => {
  test('an offer past its deadline can no longer be accepted', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Approved', responseDeadline: new Date(Date.now() - 1000),
      application: { candidateId: 7, vacancyId: 3 }
    });
    const res = mockRes();
    await offerController.accept({ params: { offerId: '20' }, user: { id: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/deadline to respond/) });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  test('a decline records the candidate\'s reason', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Approved', applicationId: 44, application: { candidateId: 7, vacancyId: 3, vacancy: { jobRef: 'R', title: 'ATC' } } })
      .mockResolvedValueOnce({ id: 20, application: { vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open' });
    prisma.offer.count.mockResolvedValue(0);
    prisma.application.count.mockResolvedValue(0);
    prisma.application.findFirst.mockResolvedValue(null);
    prisma.staffUser.findMany.mockResolvedValue([]);
    const res = mockRes();

    await offerController.decline({ params: { offerId: '20' }, body: { reason: 'Relocating' }, user: { id: 7 } }, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Approved' }, data: { status: 'Declined', decidedAt: expect.any(Date), declineReason: 'Relocating' }
    });
    expect(res.json).toHaveBeenCalledWith({ message: 'Offer declined' });
  });
});

describe('scripts/expireOffers', () => {
  const issued = (id, deadline) => ({
    id, status: 'Approved', applicationId: 40 + id, responseDeadline: deadline,
    application: { candidateId: 100 + id, vacancyId: 3, vacancy: { jobRef: 'R', title: 'ATC' }, candidate: { fullName: `Candidate ${id}` } }
  });

  test('reminds candidates near the deadline and expires lapsed offers, promoting the next reserve', async () => {
    const soon = new Date(Date.now() + 24 * 3600000);
    const past = new Date(Date.now() - 3600000);
    prisma.offer.findMany
      .mockResolvedValueOnce([issued(1, soon)]) // due for a reminder
      .mockResolvedValueOnce([issued(2, past)]); // overdue
    prisma.offer.update.mockResolvedValue({});
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.offer.findUnique.mockResolvedValue({ id: 2, application: { vacancyId: 3 } });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open' });
    prisma.offer.count.mockResolvedValue(0);
    prisma.application.count.mockResolvedValue(3);
    prisma.application.findFirst.mockResolvedValue({ id: 77 });
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }]);

    const summary = await runExpireOffers();

    expect(summary).toMatch(/1 reminder\(s\) sent, 1 offer\(s\) expired/);
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ candidateId: 101, type: 'OfferExpiring' }) });
    expect(prisma.offer.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { responseReminderSentAt: expect.any(Date) } });
    expect(prisma.offer.updateMany).toHaveBeenCalledWith({ where: { id: 2, status: 'Approved' }, data: { status: 'Expired', decidedAt: expect.any(Date) } });
    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 77 }, data: { meritListStatus: 'Primary' } });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ candidateId: 102, type: 'OfferExpired' }) });
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recipientId: 30, taskType: 'OfferExpired', message: expect.stringMatching(/application #77\) has been moved to Primary/)
    }) });
  });

  test('skips an offer answered between the read and the write', async () => {
    prisma.offer.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([issued(2, new Date(Date.now() - 1000))]);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });

    const summary = await runExpireOffers();

    expect(summary).toMatch(/0 offer\(s\) expired/);
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
  });
});
