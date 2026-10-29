jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const notices = require('../src/services/requesterNoticeService');

// Whoever asked for an approval hears when it is given.
const req = { user: { id: 2, name: 'Dee Director' } };
const inApp = () => prisma.notification.create.mock.calls.map(([{ data }]) => data).filter((d) => d.channel === 'InApp');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.staffUser.findMany.mockImplementation(async ({ where }) => where.id.in.map((id) => ({ id })));
  prisma.staffUser.findUnique.mockResolvedValue(null);
});

test("a vacancy's creator is told it was approved, with a link to it", async () => {
  await notices.vacancyApproved({ id: 5, jobRef: 'UCAA/ADV/INT/005/2026', title: 'Pilot', createdById: 12 }, req);
  expect(inApp()).toEqual([expect.objectContaining({
    recipientId: 12, taskType: 'ApprovalGiven', taskId: 5, link: '/hr/vacancy/5',
    message: expect.stringMatching(/UCAA\/ADV\/INT\/005\/2026 Pilot was approved by Dee Director/)
  })]);
});

test("an offer's recommender and checker are both told it was approved - once each, never the approver", async () => {
  const offer = { id: 20, recommendedById: 5, checkedById: 2, application: { vacancyId: 3, vacancy: { jobRef: 'REF/1', title: 'Pilot' } } };
  await notices.offerApproved(offer, req, 'Ann Applicant');
  expect(inApp().map((d) => d.recipientId)).toEqual([5]);
  expect(inApp()[0]).toMatchObject({ link: '/hr/vacancy/3?tab=merit', message: expect.stringMatching(/offer to Ann Applicant .* approved .* issued/) });
});

test('everyone who proposed a shortlist hears once, and inactive accounts not at all', async () => {
  prisma.staffUser.findMany.mockResolvedValue([{ id: 7 }]);
  await notices.shortlistApproved({ id: 3, jobRef: 'REF/1', title: 'Pilot' }, [7, 7, 9, null], 2, req);
  expect(prisma.staffUser.findMany).toHaveBeenCalledWith({ where: { id: { in: [7, 9] }, active: true }, select: { id: true } });
  expect(inApp().map((d) => d.recipientId)).toEqual([7]);
});

test('whoever added an organisation item is told, with a link to it', async () => {
  await notices.orgItemApproved('Position', { id: 40, name: 'Pilot', code: 'PLT', createdById: 6 }, req);
  expect(inApp()[0]).toMatchObject({ recipientId: 6, link: '/hr/organisation/positions?open=40', message: expect.stringMatching(/title Pilot \(PLT\) was approved/) });
});

test('a failure to notify never breaks the approval', async () => {
  prisma.staffUser.findMany.mockRejectedValue(new Error('db down'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(notices.meritListApproved({ id: 3 }, [7], req)).resolves.toBeUndefined();
  spy.mockRestore();
});
