jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/services/entraAuthService', () => {
  const actual = jest.requireActual('../src/services/entraAuthService');
  return { ...actual, verifyIdToken: jest.fn() };
});

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../src/config/db');
const { verifyIdToken, EntraAuthError } = require('../src/services/entraAuthService');
const staffAuth = require('../src/controllers/staffAuthController');
const candidateAuth = require('../src/controllers/candidateAuthController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const IDENTITY = { oid: 'oid-123', email: 'jane@caa.co.ug', name: 'Jane Okello' };
const STAFF = {
  id: 7, name: 'Jane Okello', email: 'jane@caa.co.ug', role: 'Senior_HR_Officer', isSystemAdmin: false,
  active: true, department: 'HR', departmentId: 3, entraObjectId: null, passwordHash: null
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
  delete process.env.BREAK_GLASS_LOGIN;
  delete process.env.DEV_PASSWORD_LOGIN;
  verifyIdToken.mockResolvedValue(IDENTITY);
  prisma.staffUser.update.mockImplementation(({ where, data }) => Promise.resolve({ ...STAFF, id: where.id, ...data }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('staff Microsoft sign-in', () => {
  test('the first sign-in links the account by email and gives a session with its role', async () => {
    prisma.staffUser.findUnique
      .mockResolvedValueOnce(null) // by oid
      .mockResolvedValueOnce(STAFF); // by email
    const res = mockRes();

    await staffAuth.entraLogin({ body: { idToken: 'x' } }, res);

    expect(prisma.staffUser.update).toHaveBeenCalledWith({
      where: { id: 7 }, data: expect.objectContaining({ entraObjectId: 'oid-123', lastLoginAt: expect.any(Date) })
    });
    const body = res.json.mock.calls[0][0];
    expect(body.role).toBe('Senior_HR_Officer');
    expect(jwt.verify(body.token, 'test-secret')).toMatchObject({ type: 'staff', id: 7, role: 'Senior_HR_Officer' });
  });

  test('after linking, the Microsoft identity alone matches', async () => {
    prisma.staffUser.findUnique.mockResolvedValueOnce({ ...STAFF, entraObjectId: 'oid-123', email: 'old.name@caa.co.ug' });
    const res = mockRes();

    await staffAuth.entraLogin({ body: { idToken: 'x' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(prisma.staffUser.findUnique).toHaveBeenCalledTimes(1);
  });

  test('any other UCAA employee is refused - Entra proves identity, the staff list decides access', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    const res = mockRes();

    await staffAuth.entraLogin({ body: { idToken: 'x' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('a mailbox now belonging to a different Microsoft identity cannot take the account over', async () => {
    prisma.staffUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...STAFF, entraObjectId: 'someone-else' });
    const res = mockRes();

    await staffAuth.entraLogin({ body: { idToken: 'x' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('a deactivated account is refused', async () => {
    prisma.staffUser.findUnique.mockResolvedValueOnce({ ...STAFF, entraObjectId: 'oid-123', active: false });
    const res = mockRes();

    await staffAuth.entraLogin({ body: { idToken: 'x' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a refused token passes its status through', async () => {
    verifyIdToken.mockRejectedValue(new EntraAuthError('Guest accounts cannot sign in here.', 403));
    const res = mockRes();

    await staffAuth.entraLogin({ body: { idToken: 'x' } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staffUser.findUnique).not.toHaveBeenCalled();
  });
});

describe('staff password sign-in (break-glass / development only)', () => {
  const password = 'Sealed-Envelope-1';
  let passwordHash;
  beforeAll(async () => { passwordHash = await bcrypt.hash(password, 4); });

  test('is off by default', async () => {
    const res = mockRes();

    await staffAuth.login({ body: { email: 'admin@caa.co.ug', password } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.staffUser.findUnique).not.toHaveBeenCalled();
  });

  test('break-glass lets a system administrator in, and audits it', async () => {
    process.env.BREAK_GLASS_LOGIN = 'true';
    const admin = { ...STAFF, role: null, isSystemAdmin: true, passwordHash };
    prisma.staffUser.findUnique.mockResolvedValue(admin);
    prisma.staffUser.update.mockImplementation(({ data }) => Promise.resolve({ ...admin, ...data }));
    const res = mockRes();

    await staffAuth.login({ body: { email: 'jane@caa.co.ug', password } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].isSystemAdmin).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityType: 'StaffUser', action: 'PasswordSignIn' })
    });
  });

  test('break-glass never lets in an account that is not a system administrator', async () => {
    process.env.BREAK_GLASS_LOGIN = 'true';
    prisma.staffUser.findUnique.mockResolvedValue({ ...STAFF, passwordHash });
    const res = mockRes();

    await staffAuth.login({ body: { email: 'jane@caa.co.ug', password } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('the development flag lets a seeded account in', async () => {
    process.env.DEV_PASSWORD_LOGIN = 'true';
    prisma.staffUser.findUnique.mockResolvedValue({ ...STAFF, passwordHash });
    const res = mockRes();

    await staffAuth.login({ body: { email: 'jane@caa.co.ug', password } }, res);

    expect(res.status).not.toHaveBeenCalled();
  });

  test('the development flag is ignored in production', async () => {
    process.env.DEV_PASSWORD_LOGIN = 'true';
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = mockRes();
      await staffAuth.login({ body: { email: 'jane@caa.co.ug', password } }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });

  test('a wrong password is refused', async () => {
    process.env.BREAK_GLASS_LOGIN = 'true';
    prisma.staffUser.findUnique.mockResolvedValue({ ...STAFF, isSystemAdmin: true, passwordHash });
    const res = mockRes();

    await staffAuth.login({ body: { email: 'jane@caa.co.ug', password: 'guess' } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('candidates sign in with email and password only', () => {
  test('there is no candidate Microsoft sign-in', () => {
    expect(candidateAuth.entraLogin).toBeUndefined();
  });

  test('registering with a UCAA address opens an Internal password account', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    prisma.pendingCandidateRegistration.findUnique.mockResolvedValue(null);
    prisma.pendingCandidateRegistration.create.mockImplementation(({ data }) => Promise.resolve({ id: 5, ...data }));
    const res = mockRes();

    await candidateAuth.register({ body: { fullName: 'Jane', email: 'jane@caa.co.ug', password: 'Str0ng!Pass' } }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.pendingCandidateRegistration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'jane@caa.co.ug', candidateType: 'Internal', passwordHash: expect.any(String) })
    });
  });

  test('an account with no password yet is told to set one with "Forgot password"', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 41, email: 'jane@caa.co.ug', passwordHash: null, emailConfirmed: true });
    const res = mockRes();

    await candidateAuth.login({ body: { email: 'jane@caa.co.ug', password: 'anything' } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Forgot password') });
  });
});
