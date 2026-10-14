jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const requestContext = require('../src/utils/requestContext');
const activityLog = require('../src/services/activityLogService');
const { actionFor, describeRoute } = require('../src/utils/activityActions');

beforeEach(() => jest.clearAllMocks());

// A request as Express would hand it over, after routing.
function fakeReq({ method = 'PATCH', url = '/api/vacancies/5/approve', baseUrl = '/api/vacancies', route = '/:id/approve', params = { id: '5' }, user, ip = '::ffff:10.1.2.3', ua = 'Mozilla/5.0', body } = {}) {
  return {
    method, originalUrl: url, url, baseUrl, route: route ? { path: route } : undefined, params, user, ip, body,
    get: (h) => (h.toLowerCase() === 'user-agent' ? ua : undefined)
  };
}
const fakeRes = (statusCode = 200, locals = {}) => ({ statusCode, locals, setHeader: jest.fn(), on: jest.fn() });

describe('what is captured about a request', () => {
  test('the address plain, the path with no query string and secret tokens masked', () => {
    expect(requestContext.clientIp(fakeReq())).toBe('10.1.2.3');
    expect(requestContext.safePath(fakeReq({ url: '/api/files/cv-1.pdf?token=eyJhbGciOi' }))).toBe('/api/files/cv-1.pdf');
    expect(requestContext.safePath(fakeReq({ url: '/api/shortlist-panel/3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c/submit' }))).toBe('/api/shortlist-panel/:token/submit');
    expect(requestContext.safePath(fakeReq({ url: '/api/vacancies/12/approve' }))).toBe('/api/vacancies/12/approve');
    expect(requestContext.routePattern(fakeReq())).toBe('/api/vacancies/:id/approve');
  });

  test('who acted: staff (and their delegation), a candidate, a committee member, a sign-in, nobody', () => {
    expect(requestContext.actorOf({ user: { type: 'staff', id: 4, name: 'Ann' }, actingAsDelegateFor: 9 }, {}))
      .toEqual({ actorType: 'staff', staffUserId: 4, actorLabel: 'Ann', actingAsId: 9 });
    expect(requestContext.actorOf({ user: { type: 'candidate', id: 7, email: 'c@x.com' } }, {}))
      .toEqual({ actorType: 'candidate', candidateId: 7, actorLabel: 'c@x.com' });
    expect(requestContext.actorOf({ committeeMember: { name: 'Bob', email: 'bob@caa.co.ug' } }, {}))
      .toEqual({ actorType: 'committee', actorLabel: 'Bob <bob@caa.co.ug>' });
    expect(requestContext.actorOf({}, { locals: { auditActor: { actorType: 'staff', staffUserId: 2 } } }))
      .toEqual({ actorType: 'staff', staffUserId: 2 });
    expect(requestContext.actorOf({}, {})).toEqual({ actorType: 'anonymous' });
  });

  test('audit rows written during a request carry it; outside one they are the system\'s', () => {
    expect(requestContext.auditFields()).toEqual({ actorType: 'system' });
    const req = fakeReq({ user: { type: 'staff', id: 4, name: 'Ann' } });
    let fields;
    requestContext.middleware(req, fakeRes(), () => { fields = requestContext.auditFields(); });
    expect(fields).toEqual({
      actorType: 'staff', actorLabel: 'Ann', ipAddress: '10.1.2.3', userAgent: 'Mozilla/5.0',
      requestMethod: 'PATCH', requestPath: '/api/vacancies/5/approve', requestId: req.requestContext.requestId
    });
  });

  test('an upload keeps the request\'s context for what runs after it', () => {
    const { AsyncLocalStorage } = require('async_hooks');
    const elsewhere = new AsyncLocalStorage();
    // Like multer: calls next from outside the request's async context.
    const fakeMulter = { single: () => (req, res, next) => elsewhere.exit(() => setImmediate(next)) };
    const upload = requestContext.keepContext(fakeMulter).single('file');
    const req = fakeReq();
    return new Promise((resolve) => {
      requestContext.middleware(req, fakeRes(), () => upload(req, {}, () => {
        expect(requestContext.auditFields().requestId).toBe(req.requestContext.requestId);
        resolve();
      }));
    });
  });
});

describe('the activity log', () => {
  test('a change: who, what in plain words, outcome, address, browser and the ids acted on', async () => {
    const req = fakeReq({ user: { type: 'staff', id: 4, name: 'Ann' } });
    req.requestContext = { requestId: 'r-1', startedAt: Date.now() - 20 };
    await activityLog.record(req, fakeRes(200));
    expect(prisma.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      requestId: 'r-1', actorType: 'staff', staffUserId: 4, actorLabel: 'Ann', method: 'PATCH',
      path: '/api/vacancies/5/approve', route: '/api/vacancies/:id/approve', action: 'Vacancy approved',
      statusCode: 200, outcome: 'success', ipAddress: '10.1.2.3', userAgent: 'Mozilla/5.0', detail: { id: '5' }
    }) });
  });

  test('a refused sign-in records the email tried, never the password', async () => {
    const req = fakeReq({ method: 'POST', url: '/api/staff/auth/login', baseUrl: '/api/staff/auth', route: '/login', params: {}, body: { email: 'X@caa.co.ug ', password: 'secret' } });
    await activityLog.record(req, fakeRes(401));
    const data = prisma.activityLog.create.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ actorType: 'anonymous', action: 'Staff sign-in (password)', outcome: 'refused', detail: { email: 'x@caa.co.ug' } }));
    expect(JSON.stringify(data)).not.toContain('secret');
  });

  test('a successful sign-in is recorded against who signed in', async () => {
    const req = fakeReq({ method: 'POST', url: '/api/staff/auth/entra', baseUrl: '/api/staff/auth', route: '/entra', params: {} });
    await activityLog.record(req, fakeRes(200, { auditActor: { actorType: 'staff', staffUserId: 3, actorLabel: 'Jude' }, attemptedEmail: 'jude@caa.co.ug' }));
    expect(prisma.activityLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ actorType: 'staff', staffUserId: 3, outcome: 'success' }));
  });

  test('a committee link\'s token is never kept; server errors are "failed"', async () => {
    const req = fakeReq({ method: 'POST', url: '/api/shortlist-panel/3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c/submit', baseUrl: '/api/shortlist-panel', route: '/:token/submit', params: { token: '3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c' } });
    await activityLog.record(req, fakeRes(500));
    const data = prisma.activityLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toContain('3f9a8b7c6d5e');
    expect(data.outcome).toBe('failed');
  });

  test('reading notifications and draft auto-saves are left out', async () => {
    await activityLog.record(fakeReq({ url: '/api/notifications/3/read', baseUrl: '/api/notifications', route: '/:id/read' }), fakeRes());
    await activityLog.record(fakeReq({ method: 'PUT', url: '/api/vacancy-drafts/3', baseUrl: '/api/vacancy-drafts', route: '/:id' }), fakeRes());
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  test('only change requests to the API are recorded, never the scheduler\'s signals', () => {
    const res = { on: jest.fn() };
    activityLog.middleware({ method: 'GET', originalUrl: '/api/vacancies' }, res, () => {});
    activityLog.middleware({ method: 'POST', originalUrl: '/api/internal/dashboard-events' }, res, () => {});
    expect(res.on).not.toHaveBeenCalled();
    activityLog.middleware({ method: 'POST', originalUrl: '/api/vacancies' }, res, () => {});
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  test('never throws', async () => {
    prisma.activityLog.create.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(activityLog.record(fakeReq(), fakeRes())).resolves.toBeUndefined();
    console.error.mockRestore();
  });
});

describe('plain-words actions', () => {
  test('known routes have words; any other is described from its pattern', () => {
    expect(actionFor('POST', '/api/staff-users')).toBe('Staff account created');
    expect(describeRoute('POST', '/api/widgets/:id/frobnicate')).toBe('Widgets: frobnicate');
    expect(describeRoute('DELETE', '/api/widgets/:id')).toBe('Widgets: deleted');
  });
});
