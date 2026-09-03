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
    expect(res.json).toHaveBeenCalledWith([{ id: 1, message: 'hi' }]);
  });
});

describe('markRead', () => {
  test('sets readAt on the given notification', async () => {
    prisma.notification.update.mockResolvedValue({ id: 5, readAt: new Date() });
    const req = { params: { id: '5' } };
    const res = mockRes();

    await notificationController.markRead(req, res);

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { readAt: expect.any(Date) }
    });
  });
});
