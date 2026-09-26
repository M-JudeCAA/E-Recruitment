jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(true) }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const workflow = require('../src/services/workflowService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('assertCanShortlist', () => {
  test('blocks an internal candidate who is not yet HR Verified', async () => {
    prisma.application.findUnique.mockResolvedValue({
      candidate: {
        candidateType: 'Internal',
        internalProfile: { verificationStatus: 'Pending', verificationEvidenceType: null }
      }
    });

    await expect(workflow.assertCanShortlist(1)).rejects.toThrow(/must be HR Verified/);
  });

  test('blocks an internal candidate who is verified but has no evidence type on file', async () => {
    prisma.application.findUnique.mockResolvedValue({
      candidate: {
        candidateType: 'Internal',
        internalProfile: { verificationStatus: 'HR_Verified', verificationEvidenceType: null }
      }
    });

    await expect(workflow.assertCanShortlist(1)).rejects.toThrow(/requires comments or a manager/);
  });

  test('allows an internal candidate who is HR Verified with evidence', async () => {
    prisma.application.findUnique.mockResolvedValue({
      candidate: {
        candidateType: 'Internal',
        internalProfile: { verificationStatus: 'HR_Verified', verificationEvidenceType: 'Comments' }
      }
    });

    await expect(workflow.assertCanShortlist(1)).resolves.toBeUndefined();
  });

  test('allows an external candidate unconditionally, regardless of internal profile state', async () => {
    prisma.application.findUnique.mockResolvedValue({
      candidate: { candidateType: 'External', internalProfile: null }
    });

    await expect(workflow.assertCanShortlist(1)).resolves.toBeUndefined();
  });

  test('rejects Application not found', async () => {
    prisma.application.findUnique.mockResolvedValue(null);
    await expect(workflow.assertCanShortlist(1)).rejects.toThrow(/Application not found/);
  });

  // The status gate is shared by both shortlist() and saveRanking() -
  // saveRanking() previously had no such check at all and could silently
  // rewrite a Draft/Offered/Rejected/Withdrawn application back to
  // ShortlistProposed (see the comment on NOT_SHORTLISTABLE above).
  test.each(['Draft', 'Offered', 'Rejected', 'Withdrawn'])('blocks an application at status %s regardless of candidate type', async (status) => {
    prisma.application.findUnique.mockResolvedValue({
      status, candidate: { candidateType: 'External', internalProfile: null }
    });

    await expect(workflow.assertCanShortlist(1)).rejects.toThrow(/cannot be shortlisted here/);
  });

  test.each(['Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed'])(
    'allows an external candidate at status %s',
    async (status) => {
      prisma.application.findUnique.mockResolvedValue({
        status, candidate: { candidateType: 'External', internalProfile: null }
      });

      await expect(workflow.assertCanShortlist(1)).resolves.toBeUndefined();
    }
  );
});

describe('assertNotSelfApproval', () => {
  test('blocks approval when the approver created the vacancy', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 5, createdById: 42 });
    await expect(workflow.assertNotSelfApproval(5, 42)).rejects.toThrow(/Self-approval blocked/);
  });

  test('allows approval when the approver is a different person', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 5, createdById: 42 });
    await expect(workflow.assertNotSelfApproval(5, 99)).resolves.toBeUndefined();
  });
});

describe('assertNotSelfApprovedShortlist', () => {
  test('blocks approval when the approver proposed one of the vacancy\'s ShortlistProposed applications', async () => {
    prisma.application.findMany.mockResolvedValue([
      { id: 1, shortlistProposedById: 7 }, { id: 2, shortlistProposedById: 42 }
    ]);
    await expect(workflow.assertNotSelfApprovedShortlist(5, 42)).rejects.toThrow(/Self-approval blocked/);
  });

  test('allows approval when the approver proposed none of them', async () => {
    prisma.application.findMany.mockResolvedValue([
      { id: 1, shortlistProposedById: 7 }, { id: 2, shortlistProposedById: 8 }
    ]);
    await expect(workflow.assertNotSelfApprovedShortlist(5, 42)).resolves.toBeUndefined();
    expect(prisma.application.findMany).toHaveBeenCalledWith({
      where: { vacancyId: 5, status: 'ShortlistProposed' }
    });
  });
});

describe('recomputeVacancyStatus', () => {
  test('sets status to Filled once accepted offers meet positions required, stamping filledAt', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2, status: 'PartiallyFilled', filledAt: null });
    prisma.offer.count.mockResolvedValue(2);

    await workflow.recomputeVacancyStatus(1);

    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Filled', filledAt: expect.any(Date) }
    });
  });

  test('does not re-stamp filledAt on a vacancy that was already filled once', async () => {
    const firstFill = new Date('2026-01-01T00:00:00Z');
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2, status: 'Filled', filledAt: firstFill });
    prisma.offer.count.mockResolvedValue(2);

    await workflow.recomputeVacancyStatus(1);

    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Filled' } // no filledAt key at all - untouched
    });
  });

  test('sets status to PartiallyFilled when some but not all positions are accepted', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 3, status: 'Open' });
    prisma.offer.count.mockResolvedValue(1);

    await workflow.recomputeVacancyStatus(1);

    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'PartiallyFilled' }
    });
  });

  test('never overwrites a manually Closed vacancy', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 1, status: 'Closed' });
    prisma.offer.count.mockResolvedValue(1);

    await workflow.recomputeVacancyStatus(1);

    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });
});

describe('handleOfferDeclined', () => {
  test('promotes the next-ranked reserve candidate to Primary', async () => {
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.offer.findUnique.mockResolvedValue({
      id: 10,
      application: { vacancyId: 1, candidateId: 7 }
    });
    prisma.application.findFirst.mockResolvedValue({ id: 22, rank: 4, listStatus: 'Reserve' });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 3, status: 'PartiallyFilled' });
    prisma.offer.count.mockResolvedValue(2);

    const result = await workflow.handleOfferDeclined(10);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'Approved' }, data: { status: 'Declined', decidedAt: expect.any(Date) }
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 22 },
      data: { listStatus: 'Primary' }
    });
    expect(result.promoted.id).toBe(22);
  });

  test('returns no promotion when the reserve list is exhausted', async () => {
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.offer.findUnique.mockResolvedValue({
      id: 10,
      application: { vacancyId: 1, candidateId: 7 }
    });
    prisma.application.findFirst.mockResolvedValue(null);
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 3, status: 'PartiallyFilled' });
    prisma.offer.count.mockResolvedValue(1);

    const result = await workflow.handleOfferDeclined(10);

    expect(prisma.application.update).not.toHaveBeenCalled();
    expect(result.promoted).toBeNull();
  });

  // Atomic guard - an offer that's no longer Approved (already declined by
  // a prior/concurrent call, or approved-then-accepted in the meantime)
  // must not re-run the reserve-promotion cascade a second time.
  test('reports a conflict instead of re-running the cascade when the offer is no longer Approved', async () => {
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });

    const result = await workflow.handleOfferDeclined(10);

    expect(result.conflict).toBe(true);
    expect(prisma.application.findFirst).not.toHaveBeenCalled();
  });
});

describe('acceptOfferTransactionally', () => {
  test('reports a conflict instead of accepting when the offer is no longer Approved', async () => {
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(0);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });

    const result = await workflow.acceptOfferTransactionally(10, 1);

    expect(result.conflict).toBe(true);
    expect(prisma.offer.findUnique).not.toHaveBeenCalled();
  });

  test('flips the offer to Accepted and recomputes vacancy status in the same transaction', async () => {
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count
      .mockResolvedValueOnce(0) // capacity check, under the lock
      .mockResolvedValueOnce(1); // recomputeVacancyStatus, after the flip
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.offer.findUnique.mockResolvedValue({
      id: 10, status: 'Accepted',
      application: { vacancyId: 1, candidateId: 7 }
    });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 1, status: 'Open', filledAt: null });

    const result = await workflow.acceptOfferTransactionally(10, 1);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'Approved' }, data: { status: 'Accepted', decidedAt: expect.any(Date) }
    });
    expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'Filled', filledAt: expect.any(Date) } });
    expect(result.offer.id).toBe(10);
  });

  test('locks the vacancy row before any other query in the transaction', async () => {
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 2 }]);
    prisma.offer.count.mockResolvedValue(0);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });

    await workflow.acceptOfferTransactionally(10, 1);

    const [strings, vacancyId] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(/SELECT positionsRequired FROM Vacancy WHERE id = \? FOR UPDATE/);
    expect(vacancyId).toBe(1);
    // Lock first, then the capacity count - the order MySQL's snapshot rules depend on.
    expect(prisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.offer.count.mock.invocationCallOrder[0]);
  });

  test('refuses to accept once every position is already filled, without touching the offer', async () => {
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 2 }]);
    prisma.offer.count.mockResolvedValue(2);

    const result = await workflow.acceptOfferTransactionally(10, 1);

    expect(result).toEqual({ full: true });
    expect(prisma.offer.count).toHaveBeenCalledWith({ where: { status: 'Accepted', application: { vacancyId: 1 } } });
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('reports a conflict when the vacancy row no longer exists', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await workflow.acceptOfferTransactionally(10, 1);

    expect(result.conflict).toBe(true);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });
});

describe('assertNotSelfApprovedOffer', () => {
  test('blocks the person who recommended the offer from approving it', () => {
    expect(() => workflow.assertNotSelfApprovedOffer({ recommendedById: 4 }, 4)).toThrow(/Self-approval blocked/);
  });

  test('allows a different approver', () => {
    expect(() => workflow.assertNotSelfApprovedOffer({ recommendedById: 4 }, 5)).not.toThrow();
  });

  test('allows approval of a legacy offer with no recorded recommender', () => {
    expect(() => workflow.assertNotSelfApprovedOffer({ recommendedById: null }, 5)).not.toThrow();
  });
});

describe('notifySupervisor', () => {
  test('skips and logs when the internal candidate has no supervisor email on file', async () => {
    prisma.application.findUnique.mockResolvedValue({
      candidate: { candidateType: 'Internal', internalProfile: { supervisorEmail: null }, fullName: 'Jane Doe' },
      vacancy: { title: 'ARFF Officer', department: 'ARFF' }
    });

    await workflow.notifySupervisor(1);

    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: expect.stringContaining('skipped') })
      })
    );
  });

  test('sends a notification and logs it when a supervisor email exists', async () => {
    prisma.application.findUnique.mockResolvedValue({
      candidate: { candidateType: 'Internal', internalProfile: { supervisorEmail: 'boss@caa.co.ug' }, fullName: 'Jane Doe' },
      vacancy: { title: 'ARFF Officer', department: 'ARFF' }
    });

    await workflow.notifySupervisor(1);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'boss@caa.co.ug' }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: expect.stringContaining('notified') })
      })
    );
  });

  test('does nothing for external candidates', async () => {
    prisma.application.findUnique.mockResolvedValue({
      candidate: { candidateType: 'External' },
      vacancy: { title: 'X', department: 'Y' }
    });

    await workflow.notifySupervisor(1);

    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
