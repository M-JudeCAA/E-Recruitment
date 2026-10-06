jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const offerController = require('../src/controllers/offerController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// The terms every offer is recommended with.
const TERMS = {
  salaryAmount: 4500000, salaryCurrency: 'UGX', salaryPeriod: 'Monthly', employmentCategory: 'FullTime',
  startDate: '2099-01-15', dutyStation: 'Entebbe', conditions: ['Medical fitness'], responseDays: 10
};
// An offer as the approver sees it: terms present, vacancy with room.
const recommendedOffer = (overrides = {}) => ({
  id: 20, status: 'Recommended', recommendedById: 5, applicationId: 44,
  salaryAmount: 4500000, salaryCurrency: 'UGX', salaryPeriod: 'Monthly', employmentCategory: 'FullTime',
  startDate: new Date('2099-01-15'), responseDays: 10,
  application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3, jobRef: 'REF/1', title: 'Air Traffic Controller', positionsRequired: 1 } },
  ...overrides
});

describe('recommendOffer', () => {
  // An approved-merit-list Primary candidate - the only kind an offer can be
  // recommended for. Tests override what they need.
  const primary = (overrides = {}) => ({
    id: 1, status: 'Interviewed', meritStatus: 'Approved', meritListStatus: 'Primary',
    interviewRounds: [{ id: 1, roundNumber: 1, status: 'Completed', score: 78, recommendation: 'Shortlist' }],
    ...overrides
  });
  const run = async () => {
    const res = mockRes();
    await offerController.recommend({ params: { id: '1' }, body: TERMS, user: { id: 5 } }, res);
    return res;
  };

  test('rejects when the application has no scored interview yet', async () => {
    prisma.application.findUnique.mockResolvedValue(primary({ interviewRounds: [{ id: 1, roundNumber: 1, score: null, recommendation: null }] }));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('rejects when a score exists but no verdict has been finalized yet', async () => {
    prisma.application.findUnique.mockResolvedValue(primary({ interviewRounds: [{ id: 1, roundNumber: 1, score: 82, recommendation: null }] }));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('rejects when the application is not at Interviewed (e.g. already Rejected by a panel "Reject" verdict)', async () => {
    prisma.application.findUnique.mockResolvedValue(primary({
      status: 'Rejected', interviewRounds: [{ id: 1, roundNumber: 1, score: 78, recommendation: 'Reject' }]
    }));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test.each([null, 'Proposed'])('rejects an interviewed candidate whose merit list status is %s', async (meritStatus) => {
    prisma.application.findUnique.mockResolvedValue(primary({ meritStatus }));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/merit list/) });
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('rejects a Reserve candidate on the approved merit list', async () => {
    prisma.application.findUnique.mockResolvedValue(primary({ meritListStatus: 'Reserve' }));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/reserve/) });
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  // Only the MOST RECENT held round counts - an earlier "Shortlist" must not
  // still qualify once a later round has said "Reject".
  test('rejects when an earlier round said Shortlist but the most recent round said Reject', async () => {
    prisma.application.findUnique.mockResolvedValue(primary({
      interviewRounds: [
        { id: 1, roundNumber: 1, score: 90, recommendation: 'Shortlist' },
        { id: 2, roundNumber: 2, score: 40, recommendation: 'Reject' }
      ]
    }));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('ignores a cancelled later round and uses the last one that took place', async () => {
    prisma.application.findUnique.mockResolvedValue(primary({
      interviewRounds: [
        { id: 1, roundNumber: 1, status: 'Completed', score: 90, recommendation: 'Shortlist' },
        { id: 2, roundNumber: 2, status: 'Cancelled', score: null, recommendation: null }
      ]
    }));
    prisma.offer.create.mockResolvedValue({ id: 11, applicationId: 1, status: 'Recommended' });
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  // A "Hold" candidate reaches Primary only by being promoted from Reserve
  // after a declined offer (workflowService.handleOfferDeclined).
  test('accepts a "Hold" candidate promoted to Primary on the approved merit list', async () => {
    prisma.application.findUnique.mockResolvedValue(primary({
      interviewRounds: [{ id: 1, roundNumber: 1, score: 64, recommendation: 'Hold' }]
    }));
    prisma.offer.create.mockResolvedValue({ id: 11, applicationId: 1, status: 'Recommended' });
    const res = await run();
    expect(prisma.offer.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('creates a Recommended offer and moves the application to Offered for a Primary candidate', async () => {
    prisma.application.findUnique.mockResolvedValue(primary());
    prisma.offer.create.mockResolvedValue({ id: 10, applicationId: 1, status: 'Recommended' });

    const res = await run();

    expect(prisma.offer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 1, status: 'Recommended', recommendedById: 5, recommendedDate: expect.any(Date),
        salaryAmount: 4500000, employmentCategory: 'FullTime', startDate: new Date('2099-01-15'), responseDays: 10,
        conditions: ['Medical fitness'], interviewScoreAtOffer: 78
      })
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { status: 'Offered' }
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('returns 409 rather than a duplicate offer if one was already recommended', async () => {
    prisma.application.findUnique.mockResolvedValue(primary());
    prisma.offer.create.mockRejectedValue(new Error('Unique constraint failed'));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('listOffersPendingApproval', () => {
  test('returns a paginated page of what the model finds', async () => {
    const offers = [{ id: 1, status: 'Recommended' }, { id: 2, status: 'Recommended' }];
    prisma.offer.findMany.mockResolvedValue(offers);
    prisma.offer.count.mockResolvedValue(2);
    const req = { query: {} };
    const res = mockRes();

    await offerController.listPendingApproval(req, res);

    expect(prisma.offer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'Recommended' }, skip: 0, take: 20
    }));
    expect(res.json).toHaveBeenCalledWith({ data: offers, total: 2, page: 1, limit: 20 });
  });
});

describe('approveOffer', () => {
  test('returns 404 rather than crashing when the offer does not exist', async () => {
    prisma.offer.findUnique.mockResolvedValue(null);
    const req = { params: { offerId: '999' }, user: { id: 2 } };
    const res = mockRes();

    await offerController.approve(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  test('refuses to approve an offer that is not at Recommended', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await offerController.approve(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  test('blocks the Manager who recommended the offer from approving it themselves', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Recommended', recommendedById: 2, application: { candidateId: 7, vacancyId: 3 }
    });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await offerController.approve(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/Self-approval blocked/) });
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
  });

  test('refuses to issue an offer whose start date passed while it waited for approval', async () => {
    prisma.offer.findUnique.mockResolvedValue(recommendedOffer({ startDate: new Date('2020-01-15') }));
    prisma.offer.count.mockResolvedValue(0);
    const res = mockRes();

    await offerController.approve({ params: { offerId: '20' }, body: {}, user: { id: 2 } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'START_DATE_PASSED' }));
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  describe('approves only the terms the approver reviewed', () => {
    const recommendedDate = new Date('2026-10-01T09:00:00Z');

    test('terms revised since they opened it are refused', async () => {
      prisma.offer.findUnique.mockResolvedValue(recommendedOffer({ recommendedDate: new Date('2026-10-02T09:00:00Z') }));
      prisma.offer.count.mockResolvedValue(0);
      const res = mockRes();

      await offerController.approve({ params: { offerId: '20' }, body: { expectedRecommendedDate: recommendedDate.toISOString() }, user: { id: 2 } }, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'OFFER_CHANGED' }));
      expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    });

    test('the terms they saw are approved - and only those, in the write itself', async () => {
      prisma.offer.findUnique.mockResolvedValue(recommendedOffer({ recommendedDate }));
      prisma.offer.count.mockResolvedValue(0);
      prisma.offer.updateMany.mockResolvedValue({ count: 1 });
      const res = mockRes();

      await offerController.approve({ params: { offerId: '20' }, body: { expectedRecommendedDate: recommendedDate.toISOString() }, user: { id: 2 } }, res);

      expect(prisma.offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 20, status: 'Recommended', recommendedDate }
      }));
    });
  });

  test('returns 409 when a concurrent request already changed this offer', async () => {
    prisma.offer.findUnique.mockResolvedValue(recommendedOffer());
    prisma.offer.count.mockResolvedValue(0);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await offerController.approve(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('approves an existing offer and notifies the candidate they can now act on it', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce(recommendedOffer())
      .mockResolvedValueOnce(recommendedOffer({ status: 'Approved' }));
    prisma.offer.count.mockResolvedValue(0);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'candidate@example.com' });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await offerController.approve(req, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Recommended' },
      data: expect.objectContaining({ status: 'Approved', approvedById: 2, responseDeadline: expect.any(Date) })
    });
    // Deadline is responseDays (10) from approval.
    const { responseDeadline, approvedDate } = prisma.offer.updateMany.mock.calls[0][0].data;
    expect(responseDeadline - approvedDate).toBe(10 * 24 * 60 * 60 * 1000);
    expect(res.json).toHaveBeenCalled();
    // Approving is a resolution - any active OfferApproval escalation for
    // this offer should clear, not sit "active" forever.
    expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith({
      where: { taskType: 'OfferApproval', taskId: 20, resolvedAt: null },
      data: { resolvedAt: expect.any(Date) }
    });
    // Approved is the moment the candidate can actually accept/decline -
    // this is the notification that tells them an offer exists at all.
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 7, type: 'OfferReceived' })
    }));
  });
});

describe('acceptOffer / declineOffer ownership check', () => {
  test('acceptOffer rejects a candidate who does not own the offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, application: { candidateId: 99, vacancyId: 3 }
    });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.accept(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  test('acceptOffer refuses an offer that is not Approved', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Recommended', application: { candidateId: 7, vacancyId: 3 }
    });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.accept(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  test('acceptOffer returns 409 when a concurrent request already changed this offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(0);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.accept(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('acceptOffer refuses with 409 once every position on the vacancy is already filled', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(1);
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.accept(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/already been filled/) });
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('acceptOffer tells Principal HR Officers when an acceptance is refused because the vacancy is full', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Approved', applicationId: 44,
      application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3, jobRef: 'UCAA/ADV/EXT/09/2026', title: 'Pilot' } }
    });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(1);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: 'phro@caa.co.ug' });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.accept(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.staffUser.findMany).toHaveBeenCalledWith({ where: { role: 'Principal_HR_Officer', active: true }, select: { id: true } });
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recipientId: 30, channel: 'InApp', taskType: 'VacancyFilledWithOpenOffers', taskId: 20,
      message: expect.stringMatching(/UCAA\/ADV\/EXT\/09\/2026 \(Pilot\) \(application #44\).*every position is already filled/)
    }) });
  });

  test('acceptOffer flags the other open offers to HR when this acceptance fills the vacancy', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({ id: 20, status: 'Accepted', approvedDate: new Date(), application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3 } } });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique
      .mockResolvedValueOnce({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null }) // recompute, inside the transaction
      .mockResolvedValueOnce({ id: 3, status: 'Filled', jobRef: 'UCAA/ADV/EXT/09/2026', title: 'Pilot' }); // after commit
    prisma.offer.findMany.mockResolvedValue([
      { id: 21, applicationId: 60, status: 'Approved', application: { candidate: { fullName: 'Grace A.' } } },
      { id: 22, applicationId: 61, status: 'Recommended', application: { candidate: { fullName: 'John B.' } } }
    ]);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: null });
    const res = mockRes();

    await offerController.accept({ params: { offerId: '20' }, user: { id: 7 } }, res);

    expect(prisma.offer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['Recommended', 'Returned', 'Approved'] }, application: { vacancyId: 3 }, id: { not: 20 } }
    }));
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      taskType: 'VacancyFilledWithOpenOffers', taskId: 3,
      message: expect.stringMatching(/is now filled, but 2 other offers are still open: Grace A\. \(application #60, offer Approved\); John B\. \(application #61, offer Recommended\)/)
    }) });
    expect(res.json.mock.calls[0][0].id).toBe(20);
  });

  test('acceptOffer sends no open-offer notice when the vacancy still has positions left', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({ id: 20, status: 'Accepted', approvedDate: new Date(), application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3 } } });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 2 }]);
    prisma.offer.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique
      .mockResolvedValueOnce({ id: 3, positionsRequired: 2, status: 'Open', filledAt: null })
      .mockResolvedValueOnce({ id: 3, status: 'PartiallyFilled' });

    await offerController.accept({ params: { offerId: '20' }, user: { id: 7 } }, mockRes());

    expect(prisma.offer.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('acceptOffer succeeds for the actual owning candidate', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({
        id: 20, status: 'Accepted', approvedById: 2, approvedDate: new Date(), recommendedById: 5, meritRankAtOffer: 1,
        application: { id: 44, candidateId: 7, vacancyId: 3, vacancy: { positionsRequired: 1, internalSalaryRange: '10-12M', recruiterNotes: 'x' } }
      });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count
      .mockResolvedValueOnce(0) // capacity check under the lock
      .mockResolvedValueOnce(1); // recompute after the flip

    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.accept(req, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Approved' }, data: { status: 'Accepted', decidedAt: expect.any(Date) }
    });
    // The vacancy fills up (1 accepted of 1 required) - recomputeVacancyStatus
    // ran as part of the same transaction as the offer flip.
    expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'Filled', filledAt: expect.any(Date) } });
    const body = res.json.mock.calls[0][0];
    expect(body.id).toBe(20);
    expect(body.status).toBe('Accepted');
    // Staff-only offer columns stay staff-only.
    expect(body.recommendedById).toBeUndefined();
    expect(body.meritRankAtOffer).toBeUndefined();
    expect(body.application.vacancy.positionsRequired).toBe(1);
    expect(body.application.vacancy.internalSalaryRange).toBeUndefined();
    expect(body.application.vacancy.recruiterNotes).toBeUndefined();
  });

  test('declineOffer rejects a candidate who does not own the offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 21, application: { candidateId: 99, vacancyId: 3 }
    });
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.decline(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('declineOffer refuses an offer that is not Approved', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 }
    });
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.decline(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('declineOffer returns 409 when a concurrent request already changed this offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 21, status: 'Approved', application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.decline(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('declineOffer never returns the promoted reserve candidate\'s application to the decliner', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue({ id: 55, candidateId: 8, vacancyId: 3, listStatus: 'Reserve', whyThisRole: 'private answer' });
    prisma.application.update.mockResolvedValue({});
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await offerController.decline(req, res);

    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { listStatus: 'Primary' } });
    expect(res.json).toHaveBeenCalledWith({ message: 'Offer declined' });
  });

  test('declineOffer tells Principal HR Officers which reserve candidate was promoted', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', applicationId: 50, application: { candidateId: 7, vacancyId: 3, vacancy: { jobRef: 'UCAA/ADV/INT/09/2026', title: 'Engineer' } } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue({ id: 55, listStatus: 'Reserve' });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }, { id: 31 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: 'phro@caa.co.ug' });

    await offerController.decline({ params: { offerId: '21' }, user: { id: 7 } }, mockRes());

    const inApp = prisma.notification.create.mock.calls.map((c) => c[0].data).filter((d) => d.channel === 'InApp');
    expect(inApp.map((d) => d.recipientId)).toEqual([30, 31]);
    expect(inApp[0]).toEqual(expect.objectContaining({
      taskType: 'OfferDeclined', taskId: 21,
      message: expect.stringMatching(/UCAA\/ADV\/INT\/09\/2026 \(Engineer\) was declined \(application #50\)\. The next reserve candidate \(application #55\) has been moved to Primary/)
    }));
  });

  test('declineOffer tells HR when no reserve candidate is left', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', applicationId: 50, application: { candidateId: 7, vacancyId: 3, vacancy: { jobRef: 'R', title: 'T' } } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue(null);
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: null });

    await offerController.decline({ params: { offerId: '21' }, user: { id: 7 } }, mockRes());

    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      taskType: 'OfferDeclined', message: expect.stringMatching(/no reserve candidates left/)
    }) });
  });

  test('declineOffer still succeeds when notifying HR fails', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', applicationId: 50, application: { candidateId: 7, vacancyId: 3, vacancy: { jobRef: 'R', title: 'T' } } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue(null);
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    prisma.staffUser.findMany.mockRejectedValue(new Error('db blip'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();

    await offerController.decline({ params: { offerId: '21' }, user: { id: 7 } }, res);

    expect(res.json).toHaveBeenCalledWith({ message: 'Offer declined' });
    console.error.mockRestore();
  });
});

describe('withdrawOffer', () => {
  const approvedOffer = {
    id: 20, status: 'Approved', applicationId: 44,
    application: { candidateId: 7, vacancyId: 3, vacancy: { title: 'Pilot' } }
  };

  test('returns 404 for an offer that does not exist', async () => {
    prisma.offer.findUnique.mockResolvedValue(null);
    const res = mockRes();

    await offerController.withdraw({ params: { offerId: '999' }, body: {}, user: { id: 30 } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test.each(['Declined', 'Expired', 'Withdrawn'])('refuses to withdraw an offer that is already %s', async (status) => {
    prisma.offer.findUnique.mockResolvedValue({ ...approvedOffer, status });
    const res = mockRes();

    await offerController.withdraw({ params: { offerId: '20' }, body: {}, user: { id: 30 } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  describe('an accepted offer the candidate did not take up', () => {
    const acceptedOffer = { ...approvedOffer, status: 'Accepted' };
    const reason = 'Did not report on the start date';

    test('only a Manager or Director can withdraw it', async () => {
      prisma.offer.findUnique.mockResolvedValue(acceptedOffer);
      prisma.delegation.findFirst.mockResolvedValue(null);
      const res = mockRes();

      await offerController.withdraw({ params: { offerId: '20' }, body: { reason }, user: { id: 30, role: 'Principal_HR_Officer' } }, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCEPTED_OFFER_NEEDS_MANAGER' }));
      expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    });

    test('not once the candidate has been marked hired', async () => {
      prisma.offer.findUnique.mockResolvedValue(acceptedOffer);
      prisma.hire.findUnique.mockResolvedValue({ id: 3 });
      const res = mockRes();

      await offerController.withdraw({ params: { offerId: '20' }, body: { reason }, user: { id: 30, role: 'Manager' } }, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ALREADY_HIRED' }));
    });

    test('needs a reason', async () => {
      prisma.offer.findUnique.mockResolvedValue(acceptedOffer);
      prisma.hire.findUnique.mockResolvedValue(null);
      const res = mockRes();

      await offerController.withdraw({ params: { offerId: '20' }, body: { reason: 'no' }, user: { id: 30, role: 'Manager' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('a Manager withdraws it: the post is released to the next reserve and the candidate is told', async () => {
      prisma.offer.findUnique.mockResolvedValue(acceptedOffer);
      prisma.hire.findUnique.mockResolvedValue(null);
      prisma.offer.updateMany.mockResolvedValue({ count: 1 });
      prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Filled' });
      prisma.offer.count.mockResolvedValue(0);
      prisma.application.count.mockResolvedValue(2);
      prisma.application.findFirst.mockResolvedValue({ id: 45 });
      prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'cand@example.com' });
      const res = mockRes();

      await offerController.withdraw({ params: { offerId: '20' }, body: { reason }, user: { id: 30, role: 'Manager' } }, res);

      expect(prisma.offer.updateMany).toHaveBeenCalledWith({
        where: { id: 20, status: 'Accepted', hire: { is: null } },
        data: expect.objectContaining({ status: 'Withdrawn', withdrawalReason: reason })
      });
      expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 45 }, data: { meritListStatus: 'Primary' } });
      expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ candidateId: 7, type: 'OfferWithdrawn' })
      }));
    });
  });

  test('returns 409 when a concurrent action already changed the offer', async () => {
    prisma.offer.findUnique.mockResolvedValue(approvedOffer);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();

    await offerController.withdraw({ params: { offerId: '20' }, body: {}, user: { id: 30 } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('withdraws an Approved offer, audits who did it and why, and tells the candidate', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce(approvedOffer) // the controller's read
      .mockResolvedValueOnce(approvedOffer) // closeOffer's vacancy, to lock it
      .mockResolvedValueOnce({ ...approvedOffer, status: 'Withdrawn' }) // inside closeOffer
      .mockResolvedValueOnce({ ...approvedOffer, status: 'Withdrawn' }); // the response
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open' });
    prisma.offer.count.mockResolvedValue(0);
    prisma.application.count.mockResolvedValue(2);
    prisma.application.findFirst.mockResolvedValue({ id: 45 });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'cand@example.com' });
    const res = mockRes();

    await offerController.withdraw({ params: { offerId: '20' }, body: { reason: 'Position <filled>' }, user: { id: 30 } }, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Approved' },
      data: { status: 'Withdrawn', decidedAt: expect.any(Date), withdrawnById: 30, withdrawalReason: 'Position <filled>' }
    });
    // Like a decline, a withdrawal releases the position to the next reserve.
    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 45 }, data: { meritListStatus: 'Primary' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'Offer', entityId: 20, action: 'Offer withdrawn', performedById: 30,
      payload: expect.objectContaining({
        previousStatus: 'Approved', reason: 'Position <filled>', promotedApplicationId: 45,
        comment: 'Position <filled>', changes: { status: { from: 'Approved', to: 'Withdrawn' } }
      })
    }) });
    expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith({
      where: { taskType: 'OfferApproval', taskId: 20, resolvedAt: null }, data: { resolvedAt: expect.any(Date) }
    });
    // The reason goes into an HTML email body, so it is escaped.
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      candidateId: 7, type: 'OfferWithdrawn',
      message: expect.stringMatching(/Your offer for "Pilot" has been withdrawn\. Reason given: Position &lt;filled&gt;/)
    }) });
    expect(res.json.mock.calls[0][0]).toMatchObject({ status: 'Withdrawn', promotedApplicationId: 45 });
  });

  test('does not notify the candidate when withdrawing an offer they were never told about', async () => {
    const recommended = { ...approvedOffer, status: 'Recommended' };
    prisma.offer.findUnique.mockResolvedValueOnce(recommended).mockResolvedValueOnce({ ...recommended, status: 'Withdrawn' });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });

    await offerController.withdraw({ params: { offerId: '20' }, body: {}, user: { id: 30 } }, mockRes());

    expect(prisma.offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 20, status: 'Recommended' } }));
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
  });
});
