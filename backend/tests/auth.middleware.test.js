const { requireStaffRole, requireCandidate, ROLE_RANK } = require('../src/middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('ROLE_RANK ordering', () => {
  test('reflects the cumulative 5-tier hierarchy: HRO < SHRO < PHRO < Manager < Director', () => {
    expect(ROLE_RANK.HR_Officer).toBeLessThan(ROLE_RANK.Senior_HR_Officer);
    expect(ROLE_RANK.Senior_HR_Officer).toBeLessThan(ROLE_RANK.Principal_HR_Officer);
    expect(ROLE_RANK.Principal_HR_Officer).toBeLessThan(ROLE_RANK.Manager);
    expect(ROLE_RANK.Manager).toBeLessThan(ROLE_RANK.Director);
  });
});

describe('requireStaffRole', () => {
  test('rejects non-staff users outright', () => {
    const req = { user: { type: 'candidate' } };
    const res = mockRes();
    const next = jest.fn();

    requireStaffRole('HR_Officer')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an HR Officer trying to perform a Principal HR Officer action', () => {
    const req = { user: { type: 'staff', role: 'HR_Officer' } };
    const res = mockRes();
    const next = jest.fn();

    requireStaffRole('Principal_HR_Officer')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows a Director to perform an HR Officer-level action (cumulative hierarchy)', () => {
    const req = { user: { type: 'staff', role: 'Director' } };
    const res = mockRes();
    const next = jest.fn();

    requireStaffRole('HR_Officer')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects a Senior HR Officer trying to perform a Manager-level action', () => {
    const req = { user: { type: 'staff', role: 'Senior_HR_Officer' } };
    const res = mockRes();
    const next = jest.fn();

    requireStaffRole('Manager')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows an exact role match', () => {
    const req = { user: { type: 'staff', role: 'Principal_HR_Officer' } };
    const res = mockRes();
    const next = jest.fn();

    requireStaffRole('Principal_HR_Officer')(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('requireCandidate', () => {
  test('rejects staff users', () => {
    const req = { user: { type: 'staff' } };
    const res = mockRes();
    const next = jest.fn();

    requireCandidate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows candidate users', () => {
    const req = { user: { type: 'candidate' } };
    const res = mockRes();
    const next = jest.fn();

    requireCandidate(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
