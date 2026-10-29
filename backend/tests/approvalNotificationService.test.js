jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const approvals = require('../src/services/approvalNotificationService');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.staffUser.findMany.mockResolvedValue([]);
  prisma.delegation.findMany.mockResolvedValue([]);
  prisma.candidate.findMany.mockResolvedValue([]);
  prisma.notification.findMany.mockResolvedValue([]);
  prisma.notification.create.mockResolvedValue({});
  prisma.staffUser.findUnique.mockResolvedValue({ id: 1, email: 'someone@caa.co.ug' });
});

describe('who approves', () => {
  test('the tier that approves and the tier above, as the Inbox lists it', () => {
    expect(approvals.audienceRoles('Manager')).toEqual(['Manager', 'Director']);
    expect(approvals.audienceRoles('Principal_HR_Officer')).toEqual(['Principal_HR_Officer', 'Manager']);
    expect(approvals.audienceRoles('Director')).toEqual(['Director']);
    expect(approvals.audienceRoles('Principal_HR_Officer', 'Director')).toEqual(['Principal_HR_Officer', 'Manager', 'Director']);
  });

  test('includes delegates, never whoever made the request nor a delegate acting on their authority', async () => {
    prisma.staffUser.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    prisma.delegation.findMany.mockResolvedValue([
      { delegatorId: 10, delegateId: 20 }, // acting for an approver
      { delegatorId: 11, delegateId: 21 } // acting for whoever made it
    ]);
    const ids = await approvals.approverIds('vacancy', { excludeIds: [11] });
    expect(ids.sort()).toEqual([10, 20]);
    expect(prisma.staffUser.findMany).toHaveBeenCalledWith({ where: { active: true, role: { in: ['Principal_HR_Officer', 'Manager', 'Director'] } }, select: { id: true } });
  });

  test('leaves out staff who applied for the vacancy', async () => {
    prisma.staffUser.findMany
      .mockResolvedValueOnce([{ id: 10 }, { id: 12 }]) // the approvers
      .mockResolvedValueOnce([{ id: 12 }]); // staff matching an applicant
    prisma.candidate.findMany.mockResolvedValue([{ email: 'x@caa.co.ug', entraObjectId: null }]);
    expect(await approvals.approverIds('offer', { vacancyId: 3 })).toEqual([10]);
  });
});

describe('notifyApprovers', () => {
  test('tells each approver by email and in-app, opening the request in the Inbox', async () => {
    prisma.staffUser.findMany.mockResolvedValue([{ id: 10 }]);
    const told = await approvals.notifyApprovers('vacancy', { taskId: 5, vacancyId: 5, excludeIds: [9], message: 'Ann raised vacancy X for approval.' });

    expect(told).toEqual([10]);
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recipientId: 10, channel: 'InApp', taskType: 'VacancyApproval', taskId: 5,
      link: '/hr/inbox?item=vacancy-5-approveVacancy&fallback=%2Fhr%2Fvacancy%2F5'
    }) });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Approval needed: vacancy' }));
  });

  test("doesn't tell someone again while they have an unread notice about the same request", async () => {
    prisma.staffUser.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    prisma.notification.findMany.mockResolvedValue([{ recipientId: 10 }]);
    expect(await approvals.notifyApprovers('shortlist', { taskId: 5, message: 'm' })).toEqual([11]);
  });

  test('never throws', async () => {
    prisma.staffUser.findMany.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(approvals.notifyApprovers('offer', { taskId: 1, message: 'm' })).resolves.toEqual([]);
    console.error.mockRestore();
  });
});

describe('shortlistProposed', () => {
  test('not to anyone who proposed part of the shortlist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ jobRef: 'REF', title: 'ATC' });
    prisma.application.findMany.mockResolvedValue([{ shortlistProposedById: 7 }]);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 7 }, { id: 8 }]);
    expect(await approvals.shortlistProposed(3, { id: 9, name: 'Ann' })).toEqual([8]);
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      taskType: 'ShortlistProposed', message: 'Ann proposed the interview shortlist for REF ATC for your approval.'
    }) });
  });
});
