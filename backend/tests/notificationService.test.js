jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
// Requiring this at all is itself a regression test: an earlier draft
// required './mailer' (relative to services/), which doesn't exist -
// only utils/mailer.js does. A wrong path here throws at require time,
// before any test in this file even runs.
const { notify, notifyAllWithRole } = require('../src/services/notificationService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('notify', () => {
  test('always sends both channels for a recipient with an email - never one without the other', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 1, email: 'a@caa.co.ug' });

    await notify(1, 'DepartmentApproval', 5, 'A department needs your attention.');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { recipientId: 1, channel: 'InApp', taskType: 'DepartmentApproval', taskId: 5, message: 'A department needs your attention.' }
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@caa.co.ug' }));
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { recipientId: 1, channel: 'Email', taskType: 'DepartmentApproval', taskId: 5, message: 'A department needs your attention.' }
    });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
  });

  test('skips the email channel (but still records in-app) for a recipient with no email on file', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 2, email: null });

    await notify(2, 'OfferApproval', 9, 'An offer needs your attention.');

    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe('notifyAllWithRole', () => {
  test('notifies every staff member with the given role', async () => {
    prisma.staffUser.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 1, email: null });

    await notifyAllWithRole('Manager', 'OfferApproval', 3, 'msg');

    expect(prisma.staffUser.findMany).toHaveBeenCalledWith({ where: { role: 'Manager' }, select: { id: true } });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2); // one InApp row per recipient
  });
});
