jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/services/inboxService', () => ({ forStaff: jest.fn() }));
const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const inbox = require('../src/services/inboxService');
const { run, reminderTime } = require('../scripts/sendApprovalReminders');

// Wednesday 14 Oct 2026, 10:00 in Kampala (07:00Z).
const NOW = new Date('2026-10-14T07:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const vacancyItem = (id, waitedDays) => ({
  key: `vacancy-${id}-approveVacancy`, kind: 'Vacancy approval', title: `Vacancy ${id}`, waiting: `waiting ${waitedDays} days`,
  since: new Date(NOW.getTime() - waitedDays * DAY), notice: { taskType: 'VacancyApproval', taskId: id, vacancyId: id }
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APP_TIMEZONE = 'Africa/Kampala';
  prisma.staffUser.findMany.mockResolvedValue([{ id: 7, role: 'Manager', name: 'Mary', email: 'mary@caa.co.ug' }]);
  prisma.staffUser.findUnique.mockResolvedValue({ id: 7, email: 'mary@caa.co.ug' });
  prisma.notification.findMany.mockResolvedValue([]);
  prisma.notification.findFirst.mockResolvedValue(null);
  prisma.notification.create.mockResolvedValue({});
});

const inAppRows = () => prisma.notification.create.mock.calls.map((c) => c[0].data).filter((d) => d.channel === 'InApp');

describe('catching up on approvals already pending', () => {
  test('one in-app notice per request nobody told them about, and one email listing them', async () => {
    inbox.forStaff.mockResolvedValue({ items: [vacancyItem(1, 0), vacancyItem(2, 0), { key: 'closing-3', kind: 'Applications close', info: true }] });
    await run(NOW);

    expect(inAppRows().map((d) => [d.taskType, d.taskId])).toEqual([['VacancyApproval', 1], ['VacancyApproval', 2]]);
    expect(inAppRows()[0].link).toBe('/hr/inbox?item=vacancy-1-approveVacancy&fallback=%2Fhr%2Fvacancy%2F1');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'mary@caa.co.ug', subject: '2 approvals waiting for you' }));
    expect(sendMail.mock.calls[0][0].html).toContain('Vacancy approval: Vacancy 1');
  });

  test('nothing for requests they were already told about', async () => {
    inbox.forStaff.mockResolvedValue({ items: [vacancyItem(1, 0)] });
    prisma.notification.findMany.mockResolvedValue([{ taskType: 'VacancyApproval', taskId: 1 }]);
    await run(NOW);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('the daily reminder', () => {
  beforeEach(() => prisma.notification.findMany.mockResolvedValue([{ taskType: 'VacancyApproval', taskId: 1 }, { taskType: 'VacancyApproval', taskId: 2 }]));

  test('lists what has waited a day or more, once a working day', async () => {
    inbox.forStaff.mockResolvedValue({ items: [vacancyItem(1, 3), vacancyItem(2, 0)] });
    await run(NOW);

    expect(inAppRows()).toEqual([expect.objectContaining({ taskType: 'PendingApprovalsDigest', link: '/hr/inbox', message: 'Still waiting for your approval - Vacancy approval: Vacancy 1 (waiting 3 days).' })]);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'An approval is waiting for you' }));
  });

  test('not twice in a day, not at weekends, not before 08:00', async () => {
    inbox.forStaff.mockResolvedValue({ items: [vacancyItem(1, 3)] });
    prisma.notification.findFirst.mockResolvedValue({ id: 99 });
    await run(NOW);
    expect(prisma.notification.create).not.toHaveBeenCalled();

    expect(reminderTime(new Date('2026-10-17T07:00:00.000Z'))).toBe(false); // Saturday
    expect(reminderTime(new Date('2026-10-14T04:00:00.000Z'))).toBe(false); // 07:00 Kampala
    expect(reminderTime(NOW)).toBe(true);
  });
});

test("one person's failure doesn't stop the rest", async () => {
  prisma.staffUser.findMany.mockResolvedValue([{ id: 7, role: 'Manager', name: 'A', email: 'a@caa.co.ug' }, { id: 8, role: 'Manager', name: 'B', email: 'b@caa.co.ug' }]);
  inbox.forStaff.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ items: [vacancyItem(1, 0)] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await run(NOW);
  expect(inAppRows()).toEqual([expect.objectContaining({ recipientId: 8 })]);
  console.error.mockRestore();
});
