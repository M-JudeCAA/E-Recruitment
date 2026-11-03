jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/models/candidateModel', () => ({ findAuthState: jest.fn() }));
const jwt = require('jsonwebtoken');
const request = require('supertest');
const candidateModel = require('../src/models/candidateModel');
const siteStamp = require('../src/middleware/siteStamp');
const { authenticate, optionalAuthenticate, requireCandidate } = require('../src/middleware/auth');
const { authenticateFromHeaderOrQuery } = require('../src/controllers/fileController');

const SECRET = 'site-stamp-test-secret';
const staffToken = () => jwt.sign({ type: 'staff', id: 7, role: 'HR_Officer' }, SECRET);
const candidateToken = (candidateType) => jwt.sign({ type: 'candidate', id: 9, candidateType, tv: 0 }, SECRET);

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Runs a middleware on a request through `site` with this token; whether
// it went on (next) or what it answered.
function run(mw, { site, token, query } = {}) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {}, site };
  const res = mockRes();
  const next = jest.fn();
  return Promise.resolve(mw(req, res, next)).then(() => ({ req, res, next }));
}

beforeAll(() => { process.env.JWT_SECRET = SECRET; });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.REQUIRE_SITE_HEADER = 'true';
});
afterAll(() => { delete process.env.REQUIRE_SITE_HEADER; });

describe('the stamp itself', () => {
  const app = require('../src/app');

  test('a request without a stamp is refused', async () => {
    const res = await request(app).get('/api/vacancies');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SITE_HEADER_REQUIRED');
  });

  test('an unknown stamp is refused like a missing one', async () => {
    const res = await request(app).get('/api/site-status').set('X-ERecruitment-Site', 'admin');
    expect(res.status).toBe(400);
  });

  test('the health checks and the scheduler\'s internal calls need none', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    const internal = await request(app).post('/api/internal/dashboard-events').send({});
    expect(internal.status).not.toBe(400);
  });

  test('a stamped request goes through', async () => {
    const res = await request(app).get('/api/site-status').set('X-ERecruitment-Site', 'public');
    expect(res.status).toBe(200);
  });

  test.each([
    ['POST', '/api/staff/auth/login'],
    ['POST', '/api/staff/auth/entra'],
    ['POST', '/api/candidates/auth/entra']
  ])('%s %s answers 404 on the public site', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).set('X-ERecruitment-Site', 'public').send({});
    expect(res.status).toBe(404);
  });

  test('the candidates\' Microsoft sign-in still works on Internal Careers', async () => {
    const res = await request(app).post('/api/candidates/auth/entra').set('X-ERecruitment-Site', 'internal').send({});
    expect(res.status).not.toBe(404);
  });

  test('without REQUIRE_SITE_HEADER nothing is checked', async () => {
    delete process.env.REQUIRE_SITE_HEADER;
    const res = await request(app).get('/api/site-status');
    expect(res.status).toBe(200);
  });
});

describe('sessions, site by site', () => {
  test.each([
    ['public', 401],
    ['internal', 401],
    ['staff', null]
  ])('a staff session on %s', async (site, status) => {
    const { res, next } = await run(authenticate, { site, token: staffToken() });
    if (status) {
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'WRONG_SITE' }));
      expect(next).not.toHaveBeenCalled();
    } else {
      expect(next).toHaveBeenCalled();
    }
  });

  test.each([
    ['Internal', 'public', 401],
    ['Internal', 'internal', null],
    ['External', 'public', null],
    ['External', 'internal', null]
  ])('an %s candidate\'s session on %s', async (candidateType, site, status) => {
    const { res, next } = await run(authenticate, { site, token: candidateToken(candidateType) });
    if (status) expect(res.status).toHaveBeenCalledWith(401);
    else expect(next).toHaveBeenCalled();
  });

  test('an account that became Internal after its token was issued is refused on public', async () => {
    candidateModel.findAuthState.mockResolvedValue({ id: 9, candidateType: 'Internal', tokenVersion: 0, purgedAt: null });
    const req = { headers: {}, site: 'public', user: { type: 'candidate', id: 9, candidateType: 'External', tv: 0 } };
    const res = mockRes();
    const next = jest.fn();
    await requireCandidate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('public browsing refuses a staff session rather than ignoring it', async () => {
    const { res, next } = await run(optionalAuthenticate, { site: 'public', token: staffToken() });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('public browsing without a session is unaffected', async () => {
    const { next } = await run(optionalAuthenticate, { site: 'public' });
    expect(next).toHaveBeenCalled();
  });

  test('a staff token in a file link is refused on the public site', async () => {
    const { res } = await run(authenticateFromHeaderOrQuery, { site: 'public', query: { token: staffToken() } });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('with no stamp in use (req.site null) every session goes on as before', async () => {
    for (const token of [staffToken(), candidateToken('Internal')]) {
      const { next } = await run(authenticate, { site: null, token });
      expect(next).toHaveBeenCalled();
    }
  });
});

describe('the dashboard socket', () => {
  test('accepts only connections stamped staff', () => {
    expect(siteStamp.siteOf({ headers: { 'x-erecruitment-site': 'staff' } })).toBe('staff');
    expect(siteStamp.siteOf({ headers: { 'x-erecruitment-site': 'public' } })).toBe('public');
    expect(siteStamp.siteOf({ headers: {} })).toBeUndefined();
    delete process.env.REQUIRE_SITE_HEADER;
    expect(siteStamp.siteOf({ headers: {} })).toBeNull();
  });
});
