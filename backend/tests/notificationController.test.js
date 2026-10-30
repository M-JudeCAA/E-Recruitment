jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const notificationController = require('../src/controllers/notificationController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listMine', () => {
  test('returns only the caller\'s unread in-app notifications', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 1, message: 'hi' }]);
    const req = { user: { id: 7 } };
    const res = mockRes();

    await notificationController.listMine(req, res);

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientId: 7, channel: 'InApp', readAt: null },
      orderBy: { sentAt: 'desc' }
    });
    // Each with where opening it goes - worked out from its task for rows without one.
    expect(res.json).toHaveBeenCalledWith([{ id: 1, message: 'hi', link: '/hr/inbox' }]);
  });

  test('leaves out, and clears for everyone, a notice about something already done', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: 1, taskType: 'VacancyApproval', taskId: 4, sentAt: new Date(), link: '/hr/inbox?item=vacancy-4-approveVacancy' },
      { id: 2, taskType: 'ApprovalGiven', taskId: 4, sentAt: new Date(), link: '/hr/vacancy/4' }
    ]);
    prisma.vacancy.findMany.mockResolvedValue([]); // approved by someone else
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const res = mockRes();

    await notificationController.listMine({ user: { id: 7 } }, res);

    expect(prisma.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ taskType: 'VacancyApproval', taskId: 4, readAt: null })
    }));
    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ id: 2 })]);
  });
});

describe('markRead', () => {
  test('sets readAt on the given notification', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const req = { params: { id: '5' }, user: { id: 7 } };
    const res = mockRes();

    await notificationController.markRead(req, res);

    // Only the recipient's own notice.
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 5, recipientId: 7 }, data: { readAt: expect.any(Date) }
    });
    expect(res.json).toHaveBeenCalledWith({ id: 5, read: true });
  });

  test("can't mark someone else's notification read", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await notificationController.markRead({ params: { id: '5' }, user: { id: 8 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("marks all of the caller's in-app notices read", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const res = mockRes();
    await notificationController.markAllRead({ user: { id: 7 } }, res);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { recipientId: 7, channel: 'InApp', readAt: null }, data: { readAt: expect.any(Date) }
    });
    expect(res.json).toHaveBeenCalledWith({ read: 3 });
  });
});
