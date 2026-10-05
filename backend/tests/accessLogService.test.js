jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const accessLog = require('../src/services/accessLogService');

const staffReq = { user: { type: 'staff', id: 4 }, ip: '10.0.0.5' };

beforeEach(() => {
  jest.clearAllMocks();
  accessLog.resetThrottle();
});

test('records who viewed whose data', async () => {
  await accessLog.record(staffReq, { action: 'Viewed the applicants', vacancyId: 3, candidateIds: [9, 7, 9] });
  expect(prisma.dataAccessLog.create).toHaveBeenCalledWith({ data: {
    actorType: 'staff', staffUserId: 4, action: 'Viewed the applicants', vacancyId: 3, applicationId: null,
    candidateIds: [7, 9], detail: undefined, ip: '10.0.0.5'
  } });
});

test('a repeated identical view is recorded once per throttle window; a different view is not held back', async () => {
  await accessLog.record(staffReq, { action: 'Viewed the applicants', vacancyId: 3, candidateIds: [7] });
  await accessLog.record(staffReq, { action: 'Viewed the applicants', vacancyId: 3, candidateIds: [7] });
  await accessLog.record(staffReq, { action: 'Viewed the applicants', vacancyId: 3, candidateIds: [7, 8] });
  await accessLog.record({ ...staffReq, user: { type: 'staff', id: 5 } }, { action: 'Viewed the applicants', vacancyId: 3, candidateIds: [7] });
  expect(prisma.dataAccessLog.create).toHaveBeenCalledTimes(3);
});

test('a shortlisting committee member is recorded by name and email', async () => {
  await accessLog.record({ ip: '1.2.3.4' }, {
    action: 'Viewed an applicant (shortlisting committee)', applicationId: 12, candidateIds: [7],
    committeeMember: { name: 'Dr. Okello', email: 'okello@mak.ac.ug' }
  });
  expect(prisma.dataAccessLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    actorType: 'committee', actorLabel: 'Dr. Okello <okello@mak.ac.ug>', applicationId: 12
  }) });
});

test('never throws - logging must not stop HR working', async () => {
  prisma.dataAccessLog.create.mockRejectedValueOnce(new Error('db down'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(accessLog.record(staffReq, { action: 'x' })).resolves.toBeUndefined();
  console.error.mockRestore();
});

test("forApplication finds views of the application and of anything that showed its candidate, with who did it", async () => {
  prisma.dataAccessLog.findMany.mockResolvedValue([
    { id: 2, at: new Date(), actorType: 'staff', staffUserId: 4, action: 'Opened a document', applicationId: 12, detail: { document: 'cv.pdf' } },
    { id: 1, at: new Date(), actorType: 'committee', actorLabel: 'Dr. Okello <okello@mak.ac.ug>', action: 'Viewed an applicant (shortlisting committee)' }
  ]);
  prisma.staffUser.findMany.mockResolvedValue([{ id: 4, name: 'Alice HR', role: 'HR_Officer' }]);

  const rows = await accessLog.forApplication(12, 7);

  expect(prisma.dataAccessLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { OR: [{ applicationId: 12 }, { candidateIds: { array_contains: [7] } }] }
  }));
  expect(rows.map((r) => [r.who, r.document])).toEqual([
    ['Alice HR', 'cv.pdf'], ['Dr. Okello <okello@mak.ac.ug> (shortlisting committee)', null]
  ]);
});
