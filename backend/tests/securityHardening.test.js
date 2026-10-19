jest.mock('../src/config/db', () => require('./__mocks__/db'));
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/db');
const candidateAuthController = require('../src/controllers/candidateAuthController');
const { consumeToken } = require('../src/services/tokenService');
const { createRateLimiter } = require('../src/middleware/rateLimit');

function mockRes() {
  const res = { locals: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Real bcrypt work, slow while every suite runs in parallel.
jest.setTimeout(30000);

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
});
beforeEach(() => jest.clearAllMocks());

describe('candidate sign-in does not reveal which addresses are registered', () => {
  const login = (email, password = 'Wrong!Pass1') => {
    const res = mockRes();
    return candidateAuthController.login({ body: { email, password } }, res).then(() => res);
  };

  test('an unknown address gets the same answer as a wrong password, after a real bcrypt comparison', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    const compare = jest.spyOn(bcrypt, 'compare');

    const res = await login('nobody@example.com');

    expect(compare).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid credentials' });
    compare.mockRestore();
  });

  test('any UCAA address without a password account is told to use Microsoft, registered or not', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    const res = await login('someone@caa.co.ug');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'USE_MICROSOFT' }));
  });

  test('"confirm your email" is said only to someone who knows the password', async () => {
    const passwordHash = await bcrypt.hash('Right!Pass1', 4);
    prisma.candidate.findUnique.mockResolvedValue({ id: 5, email: 'a@example.com', passwordHash, emailConfirmed: false });

    const wrong = await login('a@example.com', 'Wrong!Pass1');
    expect(wrong.status).toHaveBeenCalledWith(401);

    const right = await login('a@example.com', 'Right!Pass1');
    expect(right.status).toHaveBeenCalledWith(403);
  });

  test("the session token carries the account's tokenVersion", async () => {
    const passwordHash = await bcrypt.hash('Right!Pass1', 4);
    prisma.candidate.findUnique.mockResolvedValue({
      id: 5, email: 'a@example.com', passwordHash, emailConfirmed: true, candidateType: 'External', tokenVersion: 3, lastLoginAt: new Date()
    });
    prisma.candidate.update.mockResolvedValue({});

    const res = await login('a@example.com', 'Right!Pass1');

    const { token } = res.json.mock.calls[0][0];
    expect(jwt.verify(token, 'test-secret').tv).toBe(3);
  });
});

describe('password reset', () => {
  test('ends every earlier session by moving tokenVersion on', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 1, type: 'PasswordReset', candidateId: 5, usedAt: null, expiresAt: new Date(Date.now() + 60000)
    });
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.candidate.update.mockResolvedValue({});
    const res = mockRes();

    await candidateAuthController.resetPassword({ body: { token: 't', newPassword: 'New!Passw0rd' } }, res);

    expect(prisma.candidate.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: expect.objectContaining({ tokenVersion: { increment: 1 } })
    });
  });
});

describe('emailed links are used once', () => {
  const live = { id: 1, type: 'PasswordReset', usedAt: null, expiresAt: new Date(Date.now() + 60000) };

  test('marks the token used only while still unused', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue(live);
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(consumeToken('t', 'PasswordReset')).resolves.toBe(live);
    expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 1, usedAt: null }, data: { usedAt: expect.any(Date) }
    });
  });

  test('loses the race to a request that used it a moment earlier', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue(live);
    prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(consumeToken('t', 'PasswordReset')).rejects.toThrow('already been used');
  });
});

describe('API security headers', () => {
  test('every answer carries a CSP that loads nothing, and nosniff', async () => {
    const app = require('../src/app');
    const res = await request(app).get('/health');

    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('committee link rate limit', () => {
  test('counts each link separately', () => {
    const limiter = createRateLimiter({ name: 't', windowMs: 60000, max: 1, keyFrom: (req) => `link:${req.params.token}` });
    const next = jest.fn();
    const res = mockRes();
    res.set = jest.fn();

    limiter({ params: { token: 'a' } }, res, next);
    limiter({ params: { token: 'b' } }, res, next);
    limiter({ params: { token: 'a' } }, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
