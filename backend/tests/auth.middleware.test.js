jest.mock('../src/models/delegationModel', () => ({
  findActiveForDelegate: jest.fn(),
  logUsage: jest.fn()
}));

const delegationModel = require('../src/models/delegationModel');
const { requireStaffRole, requireCandidate, ROLE_RANK } = require('../src/middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ROLE_RANK ordering', () => {
  test('reflects the cumulative 5-tier hierarchy: HRO < SHRO < PHRO < Manager < Director', () => {
    expect(ROLE_RANK.HR_Officer).toBeLessThan(ROLE_RANK.Senior_HR_Officer);
    expect(ROLE_RANK.Senior_HR_Officer).toBeLessThan(ROLE_RANK.Principal_HR_Officer);
    expect(ROLE_RANK.Principal_HR_Officer).toBeLessThan(ROLE_RANK.Manager);
    expect(ROLE_RANK.Manager).toBeLessThan(ROLE_RANK.Director);
  });
});

describe('requireStaffRole', () => {
  test('rejects non-staff users outright', async () => {
    const req = { user: { type: 'candidate' } };
    const res = mockRes();
    const next = jest.fn();

    await requireStaffRole('HR_Officer')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an HR Officer trying to perform a Principal HR Officer action (no delegation)', async () => {
    delegationModel.findActiveForDelegate.mockResolvedValue(null);
    const req = { user: { type: 'staff', role: 'HR_Officer', id: 1 } };
    const res = mockRes();
    const next = jest.fn();

    await requireStaffRole('Principal_HR_Officer')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows a Director to perform an HR Officer-level action (cumulative hierarchy)', async () => {
    const req = { user: { type: 'staff', role: 'Director', id: 1 } };
    const res = mockRes();
    const next = jest.fn();

    await requireStaffRole('HR_Officer')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects a Senior HR Officer trying to perform a Manager-level action (no delegation)', async () => {
    delegationModel.findActiveForDelegate.mockResolvedValue(null);
    const req = { user: { type: 'staff', role: 'Senior_HR_Officer', id: 1 } };
    const res = mockRes();
    const next = jest.fn();

    await requireStaffRole('Manager')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows an exact role match', async () => {
    const req = { user: { type: 'staff', role: 'Principal_HR_Officer', id: 1 } };
    const res = mockRes();
    const next = jest.fn();

    await requireStaffRole('Principal_HR_Officer')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // The 5 delegation-aware scenarios called out in the spec's own
  // verification table (Section 2).
  describe('delegation awareness', () => {
    test('own-role-sufficient: never queries for a delegation at all (avoids the extra DB call)', async () => {
      const req = { user: { type: 'staff', role: 'Principal_HR_Officer', id: 1 } };
      const res = mockRes();
      const next = jest.fn();

      await requireStaffRole('HR_Officer')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(delegationModel.findActiveForDelegate).not.toHaveBeenCalled();
    });

    test('no-delegation-fails: own role insufficient and no active delegation -> 403', async () => {
      delegationModel.findActiveForDelegate.mockResolvedValue(null);
      const req = { user: { type: 'staff', role: 'HR_Officer', id: 5 } };
      const res = mockRes();
      const next = jest.fn();

      await requireStaffRole('Principal_HR_Officer')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('valid-delegation-passes: an active delegation from a sufficiently senior delegator lets the request through and logs usage', async () => {
      delegationModel.findActiveForDelegate.mockResolvedValue({
        id: 42, delegatorId: 2, delegator: { role: 'Principal_HR_Officer' }
      });
      const req = { user: { type: 'staff', role: 'HR_Officer', id: 5 }, method: 'PATCH', originalUrl: '/api/vacancies/12/approve' };
      const res = mockRes();
      const next = jest.fn();

      await requireStaffRole('Principal_HR_Officer')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(delegationModel.logUsage).toHaveBeenCalledWith(42, 'PATCH /api/vacancies/12/approve');
      expect(req.actingAsDelegateFor).toBe(2);
    });

    test('insufficient-delegation-still-fails: an active delegation exists but the delegator is not senior enough either -> 403', async () => {
      delegationModel.findActiveForDelegate.mockResolvedValue({
        id: 43, delegatorId: 3, delegator: { role: 'Senior_HR_Officer' }
      });
      const req = { user: { type: 'staff', role: 'HR_Officer', id: 5 }, method: 'PATCH', originalUrl: '/api/x' };
      const res = mockRes();
      const next = jest.fn();

      await requireStaffRole('Principal_HR_Officer')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
      expect(delegationModel.logUsage).not.toHaveBeenCalled();
    });

    test('delegation-irrelevant-when-own-role-enough: own role already qualifies, so an active delegation (if any) is neither consulted nor logged', async () => {
      const req = { user: { type: 'staff', role: 'Manager', id: 1 }, method: 'PATCH', originalUrl: '/api/x' };
      const res = mockRes();
      const next = jest.fn();

      await requireStaffRole('Principal_HR_Officer')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(delegationModel.findActiveForDelegate).not.toHaveBeenCalled();
      expect(delegationModel.logUsage).not.toHaveBeenCalled();
    });
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
