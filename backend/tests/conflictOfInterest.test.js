jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const conflict = require('../src/services/conflictOfInterestService');
const { guardVacancy, vacancyFrom } = require('../src/middleware/applicantConflict');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const STAFF = { email: 'jane@caa.co.ug', entraObjectId: 'oid-123' };

beforeEach(() => {
  jest.clearAllMocks();
});

// Staff #7 has applied for vacancy 12; their delegator #2 for vacancy 30.
function applicationsBy(byStaff) {
  const queue = [];
  prisma.staffUser.findUnique.mockImplementation(({ where }) => {
    queue.push(where.id);
    return Promise.resolve(byStaff[where.id] ? { ...STAFF, id: where.id } : null);
  });
  prisma.application.findMany.mockImplementation(() => {
    const id = queue.shift();
    return Promise.resolve((byStaff[id] || []).map((vacancyId) => ({ vacancyId })));
  });
}

describe('which vacancies a staff member is shut out of', () => {
  test('those they applied for, matched by Microsoft identity or email, any status past Draft', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(STAFF);
    prisma.application.findMany.mockResolvedValue([{ vacancyId: 12 }, { vacancyId: 12 }, { vacancyId: 15 }]);

    const ids = await conflict.vacancyIdsAppliedForByStaff(7);

    expect(ids).toEqual([12, 15]);
    expect(prisma.application.findMany).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['Draft'] },
        candidate: { OR: [{ email: 'jane@caa.co.ug' }, { entraObjectId: 'oid-123' }] }
      },
      select: { vacancyId: true }
    });
  });

  test('plus their delegator\'s, while acting under a delegation', async () => {
    applicationsBy({ 7: [12], 2: [30] });
    const req = { user: { type: 'staff', id: 7 }, actingAsDelegateFor: 2 };

    expect(await conflict.conflictedVacancyIds(req)).toEqual([12, 30]);
  });

  test('nothing for a candidate session', async () => {
    expect(await conflict.conflictedVacancyIds({ user: { type: 'candidate', id: 7 } })).toEqual([]);
    expect(prisma.staffUser.findUnique).not.toHaveBeenCalled();
  });

  test('worked out once per request', async () => {
    applicationsBy({ 7: [12] });
    const req = { user: { type: 'staff', id: 7 } };

    await conflict.isConflicted(req, 12);
    await conflict.isConflicted(req, 13);

    expect(prisma.staffUser.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('guardVacancy', () => {
  test('refuses (409 APPLICANT_CONFLICT) on the vacancy they applied for', async () => {
    applicationsBy({ 7: [12] });
    const req = { user: { type: 'staff', id: 7 }, params: { vacancyId: '12' } };
    const res = mockRes();
    const next = jest.fn();

    await guardVacancy(vacancyFrom.param('vacancyId'))(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'APPLICANT_CONFLICT' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('lets them work on every other vacancy', async () => {
    applicationsBy({ 7: [12] });
    const req = { user: { type: 'staff', id: 7 }, params: { vacancyId: '13' } };
    const next = jest.fn();

    await guardVacancy(vacancyFrom.param('vacancyId'))(req, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  test('works out the vacancy from an offer', async () => {
    applicationsBy({ 7: [12] });
    prisma.offer.findUnique.mockResolvedValue({ application: { vacancyId: 12 } });
    const req = { user: { type: 'staff', id: 7 }, params: { offerId: '4' } };
    const res = mockRes();

    await guardVacancy(vacancyFrom.offer('offerId'))(req, res, jest.fn());

    expect(prisma.offer.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4 } }));
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('works out the vacancy from a panel member', async () => {
    applicationsBy({ 7: [12] });
    prisma.panelMember.findUnique.mockResolvedValue({ interviewRound: { application: { vacancyId: 12 } } });
    const res = mockRes();

    await guardVacancy(vacancyFrom.panelMember('panelMemberId'))({ user: { type: 'staff', id: 7 }, params: { panelMemberId: '9' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test("verifying a rival applicant's internal profile counts as running the vacancy", async () => {
    applicationsBy({ 7: [12] });
    const res = mockRes();
    const guard = guardVacancy(vacancyFrom.candidate('candidateId'));
    // The rival's own applications: vacancies 12 and 40.
    const findMany = prisma.application.findMany.getMockImplementation();
    prisma.application.findMany.mockImplementation((args) => (args.where.candidateId === 55
      ? Promise.resolve([{ vacancyId: 40 }, { vacancyId: 12 }])
      : findMany(args)));

    await guard({ user: { type: 'staff', id: 7 }, params: { candidateId: '55' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('an unknown id passes through for the controller to 404', async () => {
    prisma.application.findUnique.mockResolvedValue(null);
    const next = jest.fn();

    await guardVacancy(vacancyFrom.application('id'))({ user: { type: 'staff', id: 7 }, params: { id: '999' } }, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });
});

describe('flagStaffApplicant', () => {
  const vacancy = { id: 12, title: 'HR Analyst', jobRef: 'UCAA/ADV/INT/001/2026' };

  test('tells the other Principal HR Officers when a staff member applies', async () => {
    prisma.staffUser.findFirst.mockResolvedValue({ id: 7, name: 'Jane Okello', role: 'Senior_HR_Officer' });
    prisma.staffUser.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 3, email: 'p@caa.co.ug' });

    const staff = await conflict.flagStaffApplicant({ email: 'jane@caa.co.ug', entraObjectId: 'oid-123' }, vacancy, 99);

    expect(staff.id).toBe(7);
    expect(prisma.staffUser.findMany).toHaveBeenCalledWith({
      where: { role: 'Principal_HR_Officer', active: true, id: { not: 7 } }, select: { id: true }
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 3, taskType: 'StaffApplicantConflict', taskId: 12, channel: 'InApp' })
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityType: 'Vacancy', entityId: 12, action: 'Staff member applied' })
    });
  });

  test('falls back to the Managers when there is no other Principal HR Officer', async () => {
    prisma.staffUser.findFirst.mockResolvedValue({ id: 3, name: 'Brian', role: 'Principal_HR_Officer' });
    prisma.staffUser.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 8 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 8, email: 'm@caa.co.ug' });

    await conflict.flagStaffApplicant({ email: 'brian@caa.co.ug' }, vacancy, 99);

    expect(prisma.staffUser.findMany).toHaveBeenLastCalledWith({
      where: { role: 'Manager', active: true, id: { not: 3 } }, select: { id: true }
    });
  });

  test('does nothing for an ordinary candidate', async () => {
    prisma.staffUser.findFirst.mockResolvedValue(null);

    expect(await conflict.flagStaffApplicant({ email: 'someone@gmail.com' }, vacancy, 99)).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
