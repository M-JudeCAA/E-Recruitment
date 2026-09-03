jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const delegationController = require('../src/controllers/delegationController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('tierBelow', () => {
  test.each([
    ['Senior_HR_Officer', 'HR_Officer'],
    ['Principal_HR_Officer', 'Senior_HR_Officer'],
    ['Manager', 'Principal_HR_Officer'],
    ['Director', 'Manager'],
    ['HR_Officer', null]
  ])('tierBelow(%s) === %s', (role, expected) => {
    expect(delegationController.tierBelow(role)).toBe(expected);
  });
});

describe('create', () => {
  test('an HR Officer has nobody below them to delegate to', async () => {
    const req = {
      body: { delegateId: '4', startDate: '2026-01-01', endDate: '2026-01-05', reason: 'leave' },
      user: { id: 1, role: 'HR_Officer' }
    };
    const res = mockRes();

    await delegationController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.delegation.create).not.toHaveBeenCalled();
  });

  test('rejects a delegate who is not exactly one tier below the caller', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 4, role: 'Principal_HR_Officer' });
    const req = {
      body: { delegateId: '4', startDate: '2026-01-01', endDate: '2026-01-05', reason: 'leave' },
      user: { id: 2, role: 'Senior_HR_Officer' } // one tier below is HR_Officer, not Principal_HR_Officer
    };
    const res = mockRes();

    await delegationController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.delegation.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid delegate account', async () => {
    prisma.staffUser.findUnique.mockResolvedValue(null);
    const req = {
      body: { delegateId: '99', startDate: '2026-01-01', endDate: '2026-01-05', reason: 'leave' },
      user: { id: 2, role: 'Senior_HR_Officer' }
    };
    const res = mockRes();

    await delegationController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.delegation.create).not.toHaveBeenCalled();
  });

  test('a Senior HR Officer delegating to an HR Officer is accepted - the caller is always the delegator', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 4, role: 'HR_Officer' });
    prisma.delegation.create.mockResolvedValue({ id: 1 });
    const req = {
      body: { delegateId: '4', startDate: '2026-01-01', endDate: '2026-01-05', reason: 'annual leave' },
      user: { id: 2, role: 'Senior_HR_Officer' }
    };
    const res = mockRes();

    await delegationController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.delegation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ delegatorId: 2, delegateId: 4, authorizedById: 2, reason: 'annual leave' })
    });
  });

  test('requires a non-empty reason', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 4, role: 'HR_Officer' });
    const req = {
      body: { delegateId: '4', startDate: '2026-01-01', endDate: '2026-01-05', reason: '   ' },
      user: { id: 2, role: 'Senior_HR_Officer' }
    };
    const res = mockRes();

    await delegationController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.delegation.create).not.toHaveBeenCalled();
  });

  test('rejects an end date that is not after the start date', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ id: 4, role: 'HR_Officer' });
    const req = {
      body: { delegateId: '4', startDate: '2026-01-05', endDate: '2026-01-01', reason: 'leave' },
      user: { id: 2, role: 'Senior_HR_Officer' }
    };
    const res = mockRes();

    await delegationController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.delegation.create).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  test('a Senior HR Officer sees only delegations they made themselves', async () => {
    prisma.delegation.findMany.mockResolvedValue([{ id: 1 }]);
    const req = { user: { id: 2, role: 'Senior_HR_Officer' } };
    const res = mockRes();

    await delegationController.list(req, res);

    expect(prisma.delegation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { delegatorId: 2 }
    }));
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  test('a Principal HR Officer sees every delegation, not just their own', async () => {
    prisma.delegation.findMany.mockResolvedValue([{ id: 2 }, { id: 1 }]);
    const req = { user: { id: 9, role: 'Principal_HR_Officer' } };
    const res = mockRes();

    await delegationController.list(req, res);

    expect(prisma.delegation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: 'desc' }
    }));
    expect(prisma.delegation.findMany.mock.calls[0][0].where).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith([{ id: 2 }, { id: 1 }]);
  });
});
