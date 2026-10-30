jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const { clearResolved } = require('../src/services/noticeClearingService');

const NOW = new Date('2026-10-30T10:00:00Z');
const notice = (id, taskType, taskId, sentAt = '2026-10-29T10:00:00Z') => ({ id, taskType, taskId, sentAt: new Date(sentAt) });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.notification.updateMany.mockResolvedValue({ count: 1 });
});

describe('clearResolved', () => {
  test("clears everyone's notices about a vacancy no longer waiting for approval, and keeps the rest", async () => {
    prisma.vacancy.findMany.mockResolvedValue([{ id: 2 }]); // vacancy 2 still pending

    const cleared = await clearResolved([notice(1, 'VacancyApproval', 1), notice(2, 'VacancyApproval', 2)], NOW);

    expect(prisma.vacancy.findMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] }, status: 'PendingApproval' }, select: { id: true } });
    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
    // Not only the viewer's - every recipient's unread notice about it.
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { taskType: 'VacancyApproval', taskId: 1, channel: 'InApp', readAt: null, sentAt: { lte: NOW } },
      data: { readAt: NOW }
    });
    expect([...cleared]).toEqual([1]);
  });

  test("a checked offer clears the Managers' check notices but not the Directors' sent after it", async () => {
    const checkedAt = new Date('2026-10-29T12:00:00Z');
    prisma.offer.findMany.mockResolvedValue([{ id: 5, status: 'Recommended', checkedAt }]);

    const cleared = await clearResolved([
      notice(1, 'OfferApproval', 5, '2026-10-29T09:00:00Z'),
      notice(2, 'OfferApproval', 5, '2026-10-29T13:00:00Z')
    ], NOW);

    expect(prisma.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ taskType: 'OfferApproval', taskId: 5, sentAt: { lte: checkedAt } })
    }));
    expect([...cleared]).toEqual([1]);
  });

  test('an offer approved, returned or gone clears all its approval notices', async () => {
    prisma.offer.findMany.mockResolvedValue([{ id: 5, status: 'Approved', checkedAt: new Date('2026-10-29T12:00:00Z') }]);
    const cleared = await clearResolved([notice(1, 'OfferApproval', 5), notice(2, 'OfferApproval', 6)], NOW);
    expect([...cleared].sort()).toEqual([1, 2]);
  });

  test('a shortlist is done once nobody on the vacancy is still proposed', async () => {
    prisma.application.findMany.mockResolvedValue([{ vacancyId: 3 }]);
    const cleared = await clearResolved([notice(1, 'ShortlistProposed', 3), notice(2, 'ShortlistProposed', 4)], NOW);
    expect(prisma.application.findMany).toHaveBeenCalledWith({ where: { vacancyId: { in: [3, 4] }, status: 'ShortlistProposed' }, select: { vacancyId: true } });
    expect([...cleared]).toEqual([2]);
  });

  test('a reschedule request is done once the round is moved or cancelled', async () => {
    prisma.interviewRound.findMany.mockResolvedValue([]);
    const cleared = await clearResolved([notice(1, 'InterviewRescheduleRequested', 9)], NOW);
    expect(prisma.interviewRound.findMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, status: 'Scheduled', candidateResponse: 'RescheduleRequested' }, select: { id: true }
    });
    expect([...cleared]).toEqual([1]);
  });

  test('notices that only inform are left for their reader', async () => {
    const cleared = await clearResolved([notice(1, 'ApprovalGiven', 1), notice(2, 'OfferDeclined', 2)], NOW);
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(cleared.size).toBe(0);
  });

  test('never throws', async () => {
    prisma.vacancy.findMany.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(clearResolved([notice(1, 'VacancyApproval', 1)], NOW)).resolves.toEqual(new Set());
    console.error.mockRestore();
  });
});
