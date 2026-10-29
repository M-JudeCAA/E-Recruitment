jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/models/candidateModel', () => ({ findAuthState: jest.fn() }));

const express = require('express');
const request = require('supertest');
const candidateModel = require('../src/models/candidateModel');
const { externalSiteOpen } = require('../src/config/externalSite');
const { requireCandidate } = require('../src/middleware/auth');

// The public careers site can be closed to external applicants
// (EXTERNAL_SITE_ENABLED=false, config/externalSite.js).
const saved = process.env.EXTERNAL_SITE_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.EXTERNAL_SITE_ENABLED;
  else process.env.EXTERNAL_SITE_ENABLED = saved;
});
beforeEach(() => jest.clearAllMocks());

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

test('the site is open unless EXTERNAL_SITE_ENABLED is false', () => {
  delete process.env.EXTERNAL_SITE_ENABLED;
  expect(externalSiteOpen()).toBe(true);
  process.env.EXTERNAL_SITE_ENABLED = 'true';
  expect(externalSiteOpen()).toBe(true);
  process.env.EXTERNAL_SITE_ENABLED = ' FALSE ';
  expect(externalSiteOpen()).toBe(false);
});

describe('candidate sessions while the site is closed', () => {
  test('an External candidate can do nothing', async () => {
    process.env.EXTERNAL_SITE_ENABLED = 'false';
    candidateModel.findAuthState.mockResolvedValue({ id: 7, candidateType: 'External', purgedAt: null, tokenVersion: 0 });
    const res = mockRes();
    const next = jest.fn();
    await requireCandidate({ user: { type: 'candidate', id: 7 } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EXTERNAL_SITE_CLOSED' }));
  });

  test('an Internal candidate carries on', async () => {
    process.env.EXTERNAL_SITE_ENABLED = 'false';
    candidateModel.findAuthState.mockResolvedValue({ id: 8, candidateType: 'Internal', purgedAt: null, tokenVersion: 0 });
    const next = jest.fn();
    await requireCandidate({ user: { type: 'candidate', id: 8 } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('an External candidate carries on once it is open again', async () => {
    process.env.EXTERNAL_SITE_ENABLED = 'true';
    candidateModel.findAuthState.mockResolvedValue({ id: 7, candidateType: 'External', purgedAt: null, tokenVersion: 0 });
    const next = jest.fn();
    await requireCandidate({ user: { type: 'candidate', id: 7 } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('password sign-in and registration', () => {
  function authApp() {
    let router;
    jest.isolateModules(() => {
      jest.doMock('../src/controllers/candidateAuthController', () => {
        const ok = (req, res) => res.json({ reached: true });
        return { register: ok, confirmEmail: ok, login: ok, entraLogin: ok, forgotPassword: ok, resetPassword: ok };
      });
      router = require('../src/routes/candidateAuth');
    });
    const app = express();
    app.use(express.json());
    app.use('/auth', router);
    return app;
  }

  test.each([
    ['post', '/auth/register'], ['get', '/auth/confirm-email'], ['post', '/auth/login'],
    ['post', '/auth/forgot-password'], ['post', '/auth/reset-password']
  ])('%s %s is refused while the site is closed', async (method, path) => {
    process.env.EXTERNAL_SITE_ENABLED = 'false';
    const res = await request(authApp())[method](path).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EXTERNAL_SITE_CLOSED');
  });

  test('Microsoft sign-in for UCAA employees still works', async () => {
    process.env.EXTERNAL_SITE_ENABLED = 'false';
    const res = await request(authApp()).post('/auth/entra').send({});
    expect(res.body).toEqual({ reached: true });
  });

  test('password sign-in works while the site is open', async () => {
    process.env.EXTERNAL_SITE_ENABLED = 'true';
    const res = await request(authApp()).post('/auth/login').send({});
    expect(res.body).toEqual({ reached: true });
  });
});

test('GET /api/site-status says whether the site is open', async () => {
  const app = require('../src/app');
  process.env.EXTERNAL_SITE_ENABLED = 'false';
  expect((await request(app).get('/api/site-status')).body).toEqual({ externalSite: false });
  process.env.EXTERNAL_SITE_ENABLED = 'true';
  expect((await request(app).get('/api/site-status')).body).toEqual({ externalSite: true });
});

test('committee links point at Internal Careers while the site is closed', () => {
  const savedUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://careers.test,https://careers.test:4174,https://careers.test:4175';
  try {
    jest.isolateModules(() => {
      const { frontendUrl, internalFrontendUrl } = require('../src/config/frontendUrl');
      expect(frontendUrl).toBe('https://careers.test');
      expect(internalFrontendUrl).toBe('https://careers.test:4175');
      const { linkFor } = require('../src/controllers/shortlistCommitteeController');
      process.env.EXTERNAL_SITE_ENABLED = 'false';
      expect(linkFor({ token: 'abc' })).toBe('https://careers.test:4175/shortlist-panel/abc');
      process.env.EXTERNAL_SITE_ENABLED = 'true';
      expect(linkFor({ token: 'abc' })).toBe('https://careers.test/shortlist-panel/abc');
    });
  } finally {
    if (savedUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedUrl;
  }
});
