jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/services/interviewInvitationService', () => ({
  candidateMessage: jest.fn(() => 'Your interview was cancelled'),
  candidateInvitation: jest.fn(() => null),
  syncPanelInvitations: jest.fn()
}));

const prisma = require('../src/config/db');
const invitations = require('../src/services/interviewInvitationService');
const withdrawal = require('../src/services/applicationWithdrawalService');

beforeEach(() => jest.clearAllMocks());

const application = (overrides = {}) => ({
  id: 1, candidateId: 5, vacancyId: 3, status: 'InterviewScheduled', meritStatus: null, meritListStatus: null, ...overrides
});

describe('withdrawing an application', () => {
  test('once offered, the candidate declines the offer instead', async () => {
    await expect(withdrawal.withdraw(application({ status: 'Offered' }), '')).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/decline the offer/) });
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test.each(['Rejected', 'Withdrawn'])('nothing to withdraw at %s', async (status) => {
    await expect(withdrawal.withdraw(application({ status }), '')).rejects.toMatchObject({ status: 422 });
  });

  test('at any stage before an offer: withdrawn, off the rankings, upcoming interviews cancelled with calendar notices', async () => {
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findMany.mockResolvedValue([{ id: 8 }]);
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findUnique.mockResolvedValue({ id: 8, application: { candidateId: 5, vacancy: { title: 'ATC' } }, panelMembers: [] });

    const result = await withdrawal.withdraw(application(), 'Took another job');

    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'InterviewScheduled' },
      data: expect.objectContaining({ status: 'Withdrawn', withdrawalReason: 'Took another job', meritStatus: null, rank: null, rankVersion: { increment: 1 } })
    });
    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { id: 8, status: 'Scheduled' }, data: expect.objectContaining({ status: 'Cancelled' })
    });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'InterviewCancelled' })
    }));
    expect(invitations.syncPanelInvitations).toHaveBeenCalledWith([expect.objectContaining({ id: 8 })], 'cancelled', expect.any(Object));
    expect(result).toEqual({ cancelledInterviewIds: [8], promoted: null, wasPrimary: false });
  });

  test('a Primary on the approved merit list frees their post for the next reserve', async () => {
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(0);
    prisma.application.count.mockResolvedValue(3);
    prisma.application.findFirst.mockResolvedValue({ id: 31 });

    const result = await withdrawal.withdraw(application({ status: 'Interviewed', meritStatus: 'Approved', meritListStatus: 'Primary' }), '');

    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 31 }, data: { meritListStatus: 'Primary' } });
    expect(result.promoted.id).toBe(31);
  });

  test('an HR decision landing meanwhile stands', async () => {
    prisma.application.updateMany.mockResolvedValue({ count: 0 });
    await expect(withdrawal.withdraw(application(), '')).rejects.toMatchObject({ status: 409 });
    expect(prisma.interviewRound.findMany).not.toHaveBeenCalled();
  });
});
