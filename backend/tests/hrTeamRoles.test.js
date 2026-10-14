jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const staffUserController = require('../src/controllers/staffUserController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// The HR department, a Manager leading it, and an ICT administrator.
const ACCOUNTS = {
  1: { id: 1, name: 'Mary Manager', email: 'manager@caa.co.ug', role: 'Manager', department: 'HR', isSystemAdmin: false, active: true },
  2: { id: 2, name: 'Alice Officer', email: 'hro@caa.co.ug', role: 'HR_Officer', department: 'HR', isSystemAdmin: false, active: true },
  3: { id: 3, name: 'Dan Director', email: 'dhra@caa.co.ug', role: 'Director', department: 'HR', isSystemAdmin: false, active: true },
  4: { id: 4, name: 'Ian ICT', email: 'ict@caa.co.ug', role: 'HR_Officer', department: 'ICT', isSystemAdmin: false, active: true },
  5: { id: 5, name: 'Ada Admin', email: 'admin@caa.co.ug', role: 'Senior_HR_Officer', department: 'HR', isSystemAdmin: true, active: true },
  6: { id: 6, name: 'Paul Principal', email: 'phro@caa.co.ug', role: 'Principal_HR_Officer', department: 'HR', isSystemAdmin: false, active: true },
  7: { id: 7, name: 'Ivy ICT Manager', email: 'ictm@caa.co.ug', role: 'Manager', department: 'ICT', isSystemAdmin: false, active: true }
};
const manager = { type: 'staff', id: 1, role: 'Manager' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.staffUser.findUnique.mockImplementation(async ({ where }) => ACCOUNTS[where.id] || null);
  prisma.staffUser.findMany.mockImplementation(async ({ where }) => Object.values(ACCOUNTS).filter((a) => a.department === where.department));
  prisma.staffUser.update.mockImplementation(async ({ where, data }) => ({ ...ACCOUNTS[where.id], ...data }));
  prisma.auditLog.create.mockResolvedValue({});
});

describe('the HR Manager\'s team', () => {
  test('lists only the HR department, saying whose role they can change and to what', async () => {
    const res = mockRes();
    await staffUserController.hrTeam({ user: manager }, res);
    const { assignableRoles, accounts } = res.json.mock.calls[0][0];

    expect(assignableRoles).toEqual(['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer']);
    expect(accounts.map((a) => a.id).sort()).toEqual([1, 2, 3, 5, 6]);
    const locked = Object.fromEntries(accounts.map((a) => [a.id, a.lockedReason]));
    expect(locked[2]).toBeNull();
    expect(locked[6]).toBeNull();
    expect(locked[1]).toMatch(/your own account/);
    expect(locked[3]).toMatch(/same as you or above/);
    expect(locked[5]).toMatch(/system administrator/);
  });

  test('not for a Manager outside the HR department, nor anyone below Manager', async () => {
    let res = mockRes();
    await staffUserController.hrTeam({ user: { type: 'staff', id: 7, role: 'Manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);

    res = mockRes();
    await staffUserController.hrTeam({ user: { type: 'staff', id: 6, role: 'Principal_HR_Officer' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('acting as a Manager under a delegation is not enough', async () => {
    const res = mockRes();
    // Their own account says Principal HR Officer, whatever the gate allowed.
    await staffUserController.hrTeam({ user: { type: 'staff', id: 6, role: 'Principal_HR_Officer' }, actingAsDelegateFor: 1 }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('changing an HR staff member\'s role', () => {
  test('to a role below the manager\'s own, audited with the comment', async () => {
    const res = mockRes();
    await staffUserController.updateHrTeamRole({ user: manager, params: { id: '2' }, body: { role: 'Senior_HR_Officer', comment: 'Promoted' } }, res);

    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { role: 'Senior_HR_Officer' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 2, role: 'Senior_HR_Officer', lockedReason: null }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'StaffUser', entityId: 2, action: 'HR role changed by HR Manager', performedById: 1,
      payload: expect.objectContaining({ changes: { role: { from: 'HR_Officer', to: 'Senior_HR_Officer' } }, comment: 'Promoted' })
    }) });
  });

  test('never to their own rank or above, nor to no role', async () => {
    for (const role of ['Manager', 'Director']) {
      const res = mockRes();
      await staffUserController.updateHrTeamRole({ user: manager, params: { id: '2' }, body: { role } }, res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    const res = mockRes();
    await staffUserController.updateHrTeamRole({ user: manager, params: { id: '2' }, body: { role: null } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('not their own account, a senior\'s, or a system administrator\'s', async () => {
    for (const id of ['1', '3', '5']) {
      const res = mockRes();
      await staffUserController.updateHrTeamRole({ user: manager, params: { id }, body: { role: 'HR_Officer' } }, res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('someone outside the HR department is not found', async () => {
    const res = mockRes();
    await staffUserController.updateHrTeamRole({ user: manager, params: { id: '4' }, body: { role: 'Senior_HR_Officer' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('a Director may give up to Manager', async () => {
    const res = mockRes();
    await staffUserController.updateHrTeamRole({ user: { type: 'staff', id: 3, role: 'Director' }, params: { id: '6' }, body: { role: 'Manager' } }, res);
    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 6 }, data: { role: 'Manager' } });
  });
});

describe('the system administrator sets the department', () => {
  const ADMIN = { type: 'staff', id: 5, isSystemAdmin: true };

  test('HR or ICT, in any case; anything else is refused', async () => {
    prisma.department.findFirst.mockResolvedValue(null);
    let res = mockRes();
    await staffUserController.update({ user: ADMIN, params: { id: '2' }, body: { department: 'ict' } }, res);
    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { department: 'ICT', departmentId: null } });

    res = mockRes();
    await staffUserController.update({ user: ADMIN, params: { id: '2' }, body: { department: 'Finance' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Department must be one of: HR, ICT' });
  });
});
