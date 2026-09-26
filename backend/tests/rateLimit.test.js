const { createRateLimiter, authLimiters, byEmail } = require('../src/middleware/rateLimit');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('createRateLimiter', () => {
  function setup(max = 3, windowMs = 60000) {
    let t = 1000000;
    const limiter = createRateLimiter({ name: 'test', windowMs, max, keyFrom: (req) => req.key, now: () => t });
    const hit = (key = 'k') => {
      const res = mockRes();
      const next = jest.fn();
      limiter({ key }, res, next);
      return { res, next };
    };
    return { hit, advance: (ms) => { t += ms; } };
  }

  test('lets requests through up to the limit', () => {
    const { hit } = setup(3);
    for (let i = 0; i < 3; i++) expect(hit().next).toHaveBeenCalled();
  });

  test('refuses with 429 and Retry-After once the limit is passed', () => {
    const { hit } = setup(3, 15 * 60000);
    hit(); hit(); hit();
    const { res, next } = hit();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '900');
    expect(res.json).toHaveBeenCalledWith({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  });

  test('starts a fresh window once the old one ends', () => {
    const { hit, advance } = setup(1, 60000);
    hit();
    expect(hit().res.status).toHaveBeenCalledWith(429);
    advance(60000);
    expect(hit().next).toHaveBeenCalled();
  });

  test('counts each key separately', () => {
    const { hit } = setup(1);
    hit('a');
    expect(hit('b').next).toHaveBeenCalled();
    expect(hit('a').res.status).toHaveBeenCalledWith(429);
  });

  test('skips limiting when there is no key to count against', () => {
    const { hit } = setup(1);
    hit(null); hit(null);
    expect(hit(null).next).toHaveBeenCalled();
  });
});

describe('byEmail', () => {
  test('normalises case and surrounding spaces so variants share one budget', () => {
    expect(byEmail({ body: { email: '  Jane@CAA.co.ug ' } })).toBe('email:jane@caa.co.ug');
  });

  test('returns no key when no email was submitted', () => {
    expect(byEmail({ body: {} })).toBeNull();
    expect(byEmail({})).toBeNull();
  });
});

describe('authLimiters', () => {
  test('blocks the eleventh login attempt on one account within 15 minutes', () => {
    const [, perAccount] = authLimiters('staff').login;
    const attempt = () => {
      const res = mockRes();
      const next = jest.fn();
      perAccount({ ip: '10.0.0.1', body: { email: 'phro@caa.co.ug' } }, res, next);
      return { res, next };
    };
    for (let i = 0; i < 10; i++) expect(attempt().next).toHaveBeenCalled();
    expect(attempt().res.status).toHaveBeenCalledWith(429);
  });

  test('allows many different accounts from one shared office address', () => {
    const [perAddress] = authLimiters('candidate').login;
    for (let i = 0; i < 100; i++) {
      const next = jest.fn();
      perAddress({ ip: '196.0.0.1', body: { email: `user${i}@caa.co.ug` } }, mockRes(), next);
      expect(next).toHaveBeenCalled();
    }
  });
});
