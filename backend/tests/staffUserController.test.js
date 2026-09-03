jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/services/tokenService', () => ({ createToken: jest.fn() }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const { createToken } = require('../src/services/tokenService');
const staffUserController = require('../src/controllers/staffUserController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('create', () => {
  test.each(['Principal_HR_Officer', 'Manager', 'Director'])(
    'refuses to create a %s account through this endpoint', async (role) => {
      const req = { body: { name: 'Someone', email: 's@caa.co.ug', role }, user: { id: 2 } };
      const res = mockRes();

      await staffUserController.create(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.staffUser.create).not.toHaveBeenCalled();
    });

  test.each(['HR_Officer', 'Senior_HR_Officer'])('allows creating a %s account', async (role) => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    prisma.department.findFirst.mockResolvedValue({ id: 10, name: 'HR' });
    prisma.staffUser.create.mockResolvedValue({ id: 9, name: 'Someone', email: 's@caa.co.ug', role });
    createToken.mockResolvedValue('sometoken');
    const req = { body: { name: 'Someone', email: 's@caa.co.ug', role }, user: { id: 2 } };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendMail).toHaveBeenCalled();
  });

  test('rejects a duplicate email', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 1, email: 's@caa.co.ug' });
    const req = { body: { name: 'Someone', email: 's@caa.co.ug', role: 'HR_Officer' }, user: { id: 2 } };
    const res = mockRes();

    await staffUserController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.staffUser.create).not.toHaveBeenCalled();
  });

  test('the created account gets an unusable password hash - never a caller-supplied or guessable one', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    prisma.department.findFirst.mockResolvedValue({ id: 10, name: 'HR' });
    prisma.staffUser.create.mockResolvedValue({ id: 9, name: 'Someone', email: 's@caa.co.ug', role: 'HR_Officer' });
    createToken.mockResolvedValue('sometoken');
    const req = { body: { name: 'Someone', email: 's@caa.co.ug', role: 'HR_Officer', password: 'ILoveHacking!' }, user: { id: 2 } };
    const res = mockRes();

    await staffUserController.create(req, res);

    const data = prisma.staffUser.create.mock.calls[0][0].data;
    expect(data.passwordHash).toBeDefined();
    expect(data.passwordHash).not.toBe('ILoveHacking!');
    // response never echoes back a password/hash
    expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({ passwordHash: expect.anything() }));
  });

  test('never leaves department null against the required schema column - defaults to HR', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    prisma.department.findFirst.mockResolvedValue({ id: 10, name: 'HR' });
    prisma.staffUser.create.mockResolvedValue({ id: 9, name: 'Someone', email: 's@caa.co.ug', role: 'HR_Officer' });
    createToken.mockResolvedValue('sometoken');
    const req = { body: { name: 'Someone', email: 's@caa.co.ug', role: 'HR_Officer' }, user: { id: 2 } };
    const res = mockRes();

    await staffUserController.create(req, res);

    const data = prisma.staffUser.create.mock.calls[0][0].data;
    expect(data.department).toBe('HR');
    expect(data.departmentId).toBe(10);
  });
});

describe('updateRole', () => {
  test('refuses to promote an existing account to Principal_HR_Officer or above', async () => {
    const req = { params: { id: '1' }, body: { role: 'Manager' } };
    const res = mockRes();

    await staffUserController.updateRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('refuses to change the role of an account that is already PHRO+', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 1, role: 'Principal_HR_Officer' });
    const req = { params: { id: '1' }, body: { role: 'Senior_HR_Officer' } };
    const res = mockRes();

    await staffUserController.updateRole(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('moves an HRO to SHRO', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 1, role: 'HR_Officer' });
    prisma.staffUser.update.mockResolvedValue({ id: 1, name: 'A', email: 'a@caa.co.ug', role: 'Senior_HR_Officer' });
    const req = { params: { id: '1' }, body: { role: 'Senior_HR_Officer' } };
    const res = mockRes();

    await staffUserController.updateRole(req, res);

    expect(prisma.staffUser.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { role: 'Senior_HR_Officer' } });
  });
});
