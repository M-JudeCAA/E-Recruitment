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

describe('recomputeVacancyStatus', () => {
  test('sets status to Filled once accepted offers meet positions required', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2, status: 'PartiallyFilled' });
    prisma.offer.count.mockResolvedValue(2);

    await workflow.recomputeVacancyStatus(1);

    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'Filled' }
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
    prisma.offer.update.mockResolvedValue({
      id: 10,
      application: { vacancyId: 1, candidateId: 7 }
    });
    prisma.application.findFirst.mockResolvedValue({ id: 22, rank: 4, listStatus: 'Reserve' });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 3, status: 'PartiallyFilled' });
    prisma.offer.count.mockResolvedValue(2);

    const result = await workflow.handleOfferDeclined(10);

    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 22 },
      data: { listStatus: 'Primary' }
    });
    expect(result.promoted.id).toBe(22);
  });

  test('returns no promotion when the reserve list is exhausted', async () => {
    prisma.offer.update.mockResolvedValue({
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
