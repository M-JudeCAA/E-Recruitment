jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const staffUserController = require('../src/controllers/staffUserController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const ADMIN = { type: 'staff', id: 1, isSystemAdmin: true };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
  prisma.department.findFirst.mockResolvedValue({ id: 10, name: 'HR' });
});

describe('create', () => {
  test.each(['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director'])(
    'a system administrator can create a %s account', async (role) => {
      prisma.staffUser.findUnique.mockResolvedValue(null);
      prisma.staffUser.create.mockImplementation(({ data }) => Promise.resolve({ id: 9, active: true, ...data }));
      const req = { body: { name: 'Someone', email: 'S@CAA.co.ug', role }, user: ADMIN };
      const res = mockRes();

      await staffUserController.create(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const data = prisma.staffUser.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ email: 's@caa.co.ug', role, department: 'HR', departmentId: 10, isSystemAdmin: false });
      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 's@caa.co.ug' }));
    });

  test('creates no password at all - staff sign in with Microsoft', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    prisma.staffUser.create.mockImplementation(({ data }) => Promise.resolve({ id: 9, ...data }));
    const req = { body: { name: 'Someone', email: 's@caa.co.ug', role: 'HR_Officer', password: 'ILoveHacking!' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(prisma.staffUser.create.mock.calls[0][0].data.passwordHash).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({ passwordHash: expect.anything() }));
  });

  test('refuses an address outside the UCAA domain - it must be the Microsoft account they sign in with', async () => {
    const req = { body: { name: 'Someone', email: 'someone@gmail.com', role: 'HR_Officer' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staffUser.create).not.toHaveBeenCalled();
  });

  test('creates an accounts-only system administrator (no HR role)', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    prisma.staffUser.create.mockImplementation(({ data }) => Promise.resolve({ id: 9, ...data }));
    const req = { body: { name: 'IT', email: 'it@caa.co.ug', role: null, isSystemAdmin: true, department: 'ICT' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.staffUser.create.mock.calls[0][0].data).toMatchObject({ role: null, isSystemAdmin: true, department: 'ICT' });
  });

  test('refuses an account with neither an HR role nor administrator rights', async () => {
    const req = { body: { name: 'Nobody', email: 'n@caa.co.ug', role: null }, user: ADMIN };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('refuses an unknown role', async () => {
    const req = { body: { name: 'Someone', email: 's@caa.co.ug', role: 'Overlord' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a duplicate email', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 1, email: 's@caa.co.ug' });
    const req = { body: { name: 'Someone', email: 's@caa.co.ug', role: 'HR_Officer' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.staffUser.create).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  const existing = { id: 5, name: 'Sam', email: 'sam@caa.co.ug', role: 'HR_Officer', isSystemAdmin: false, active: true, department: 'HR' };

  test('changes a role', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(existing);
    prisma.staffUser.update.mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data }));
    const req = { params: { id: '5' }, body: { role: 'Manager' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.update(req, res);

    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { role: 'Manager' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ role: 'Manager' }));
  });

  test('deactivates an account', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(existing);
    prisma.staffUser.update.mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data }));
    const req = { params: { id: '5' }, body: { active: false }, user: ADMIN };
    const res = mockRes();

    await staffUserController.update(req, res);

    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { active: false } });
  });

  test('nobody changes their own account - an administrator cannot hand themselves an HR role', async () => {
    const req = { params: { id: '1' }, body: { role: 'Director' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('the last active administrator cannot be removed', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ ...existing, role: null, isSystemAdmin: true });
    prisma.staffUser.count.mockResolvedValue(1);
    const req = { params: { id: '5' }, body: { active: false }, user: ADMIN };
    const res = mockRes();

    await staffUserController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('another administrator can be removed while one remains', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ ...existing, role: 'HR_Officer', isSystemAdmin: true });
    prisma.staffUser.count.mockResolvedValue(2);
    prisma.staffUser.update.mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data }));
    const req = { params: { id: '5' }, body: { isSystemAdmin: false }, user: ADMIN };
    const res = mockRes();

    await staffUserController.update(req, res);

    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { isSystemAdmin: false } });
  });

  test('an account cannot be left with no role and no administrator rights', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(existing);
    const req = { params: { id: '5' }, body: { role: null }, user: ADMIN };
    const res = mockRes();

    await staffUserController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 for an unknown account', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    const req = { params: { id: '99' }, body: { role: 'Manager' }, user: ADMIN };
    const res = mockRes();

    await staffUserController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('unlink', () => {
  test('forgets the linked Microsoft identity so the next sign-in links again', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 5, entraObjectId: 'oid-1' });
    const req = { params: { id: '5' }, body: {}, user: ADMIN };
    const res = mockRes();

    await staffUserController.unlink(req, res);

    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { entraObjectId: null } });
  });
});

describe('list', () => {
  test('the HR directory is active staff holding an HR role', async () => {
    prisma.staffUser.findMany.mockResolvedValue([]);

    await staffUserController.list({ user: { id: 2 } }, mockRes());

    expect(prisma.staffUser.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, role: { not: null } }
    }));
  });

  test("the administrator's list shows whether each account is linked, not the Microsoft id", async () => {
    prisma.staffUser.findMany.mockResolvedValue([{ id: 5, name: 'Sam', entraObjectId: 'oid-1' }, { id: 6, name: 'Ann', entraObjectId: null }]);
    const res = mockRes();

    await staffUserController.listAccounts({ user: ADMIN }, res);

    expect(res.json).toHaveBeenCalledWith([{ id: 5, name: 'Sam', linked: true }, { id: 6, name: 'Ann', linked: false }]);
  });
});
