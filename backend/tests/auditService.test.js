jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const audit = require('../src/services/auditService');
const auditController = require('../src/controllers/auditController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('diff', () => {
  test('lists only the fields that changed, comparing dates and JSON by value', () => {
    const before = { status: 'Open', deadline: new Date('2026-10-01T00:00:00Z'), tags: ['a'], title: 'X' };
    const after = { status: 'Closed', deadline: new Date('2026-10-01T00:00:00Z'), tags: ['a'], title: 'X' };
    expect(audit.diff(before, after)).toEqual({ status: { from: 'Open', to: 'Closed' } });
  });

  test('limits the comparison to the given fields and treats a missing value as null', () => {
    expect(audit.diff({ a: 1, b: 2 }, { a: 5, b: 3, c: 'new' }, ['b', 'c'])).toEqual({
      b: { from: 2, to: 3 }, c: { from: null, to: 'new' }
    });
  });
});

describe('actorFrom', () => {
  test('records the staff member and the delegation they acted under', () => {
    expect(audit.actorFrom({ user: { type: 'staff', id: 4 }, actingAsDelegateFor: 9 })).toEqual({ performedById: 4, actingAsId: 9 });
  });

  test('records a candidate separately - their id is not a StaffUser id', () => {
    expect(audit.actorFrom({ user: { type: 'candidate', id: 4 } })).toEqual({ candidateId: 4 });
  });
});

describe('record', () => {
  test('writes the actor, the changes and the comment', async () => {
    await audit.record({
      entityType: 'Vacancy', entityId: 3, action: 'Vacancy closed', actor: { performedById: 2, actingAsId: null },
      before: { status: 'Open' }, after: { status: 'Closed' }, comment: 'Position frozen'
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: {
      entityType: 'Vacancy', entityId: 3, action: 'Vacancy closed', performedById: 2, actingAsId: null,
      payload: { changes: { status: { from: 'Open', to: 'Closed' } }, comment: 'Position frozen' }
    } });
  });

  test("marks a candidate's own action in the payload, with no staff performer", async () => {
    await audit.record({ entityType: 'Application', entityId: 8, action: 'Application withdrawn', actor: { candidateId: 5 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      performedById: null, payload: { actor: { type: 'candidate', id: 5 } }
    }) });
  });

  test('never throws - the action it records has already committed', async () => {
    prisma.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(audit.record({ entityType: 'Vacancy', entityId: 1, action: 'x' })).resolves.toBeUndefined();
    console.error.mockRestore();
  });
});

describe('GET /api/audit/:entityType/:entityId', () => {
  test('returns the changes and comments, never the rest of the stored payload', async () => {
    prisma.auditLog.findMany.mockResolvedValue([{
      id: 1, action: 'Application submitted', timestamp: new Date(), actingAsId: null, performedBy: null,
      payload: { changes: { status: { from: 'Draft', to: 'Submitted' } }, actor: { type: 'candidate', id: 5 }, workExperience: ['secret'] }
    }]);
    const res = mockRes();
    await auditController.history({ params: { entityType: 'Application', entityId: '8' } }, res);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityType: 'Application', entityId: 8 } }));
    const [row] = res.json.mock.calls[0][0];
    expect(row).toEqual(expect.objectContaining({ changes: { status: { from: 'Draft', to: 'Submitted' } }, byCandidate: true }));
    expect(JSON.stringify(row)).not.toContain('secret');
  });

  test('refuses entity types outside the allowed list', async () => {
    const res = mockRes();
    await auditController.history({ params: { entityType: 'ApplicationSnapshot', entityId: '8' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
