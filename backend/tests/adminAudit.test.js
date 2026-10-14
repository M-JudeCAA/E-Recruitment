jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const adminAudit = require('../src/services/adminAuditService');
const controller = require('../src/controllers/adminAuditController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn();
  res.send = jest.fn();
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APP_TIMEZONE = 'Africa/Kampala';
  prisma.staffUser.findMany.mockResolvedValue([{ id: 4, name: 'Ann', email: 'ann@caa.co.ug' }, { id: 9, name: 'Dee', email: 'dee@caa.co.ug' }]);
  prisma.auditLog.create.mockResolvedValue({});
});

describe('filters', () => {
  test('activity: days in Kampala, who, outcome, address, sign-ins, free text', () => {
    expect(adminAudit.activityWhere({ from: '2026-10-01', to: '2026-10-14', staffUserId: '4', outcome: 'refused', ip: '10.1', signIns: 'true', q: 'approve' })).toEqual({
      at: { gte: new Date('2026-09-30T21:00:00.000Z'), lt: new Date('2026-10-14T21:00:00.000Z') },
      staffUserId: 4, outcome: 'refused', ipAddress: { contains: '10.1' }, route: { contains: '/auth/' },
      OR: [{ actorLabel: { contains: 'approve' } }, { action: { contains: 'approve' } }, { path: { contains: 'approve' } }, { ipAddress: { contains: 'approve' } }]
    });
    expect(adminAudit.activityWhere({ outcome: 'nonsense', from: 'yesterday' })).toEqual({});
  });

  test('changes: the record, who and where', () => {
    expect(adminAudit.changesWhere({ entityType: 'Vacancy', entityId: '5', staffUserId: '4', ip: '10.' }))
      .toEqual({ entityType: 'Vacancy', entityId: 5, performedById: 4, ipAddress: { contains: '10.' } });
  });
});

describe('reading the logs', () => {
  test('activity rows name the staff member and who they acted for', async () => {
    prisma.activityLog.findMany.mockResolvedValue([{ id: 1, at: new Date(), staffUserId: 4, actingAsId: 9, action: 'Vacancy approved' }]);
    prisma.activityLog.count.mockResolvedValue(1);
    const result = await adminAudit.activity({ page: '1' });
    expect(result).toEqual(expect.objectContaining({ total: 1, page: 1, pageSize: 50 }));
    expect(result.rows[0]).toEqual(expect.objectContaining({ staff: expect.objectContaining({ name: 'Ann' }), actingAs: expect.objectContaining({ name: 'Dee' }) }));
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50, orderBy: [{ at: 'desc' }, { id: 'desc' }] }));
  });

  test('changes rows split the payload into changes, comment and the rest', async () => {
    prisma.auditLog.findMany.mockResolvedValue([{
      id: 2, timestamp: new Date(), entityType: 'Vacancy', entityId: 5, action: 'Vacancy rejected', actingAsId: null,
      payload: { changes: { status: { from: 'PendingApproval', to: 'Rejected' } }, comment: 'Not budgeted', jobRef: 'REF' }
    }]);
    prisma.auditLog.count.mockResolvedValue(1);
    const { rows } = await adminAudit.changes({});
    expect(rows[0]).toEqual(expect.objectContaining({
      changes: { status: { from: 'PendingApproval', to: 'Rejected' } }, comment: 'Not budgeted', details: { jobRef: 'REF' }, candidateId: null
    }));
  });

  test('page size is capped', async () => {
    prisma.dataAccessLog.findMany.mockResolvedValue([]);
    prisma.dataAccessLog.count.mockResolvedValue(0);
    expect((await adminAudit.access({ pageSize: '5000' })).pageSize).toBe(200);
  });
});

describe('controller', () => {
  test('an unknown log is a 404', async () => {
    const res = mockRes();
    await controller.list({ params: { kind: 'secrets' }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('an export is a CSV, and is itself audited', async () => {
    prisma.activityLog.findMany.mockResolvedValue([{ id: 1, at: new Date('2026-10-14T07:00:00Z'), actorLabel: 'Ann', actorType: 'staff', action: 'Vacancy approved', outcome: 'success', statusCode: 200, method: 'PATCH', path: '/api/vacancies/5/approve', ipAddress: '10.1.2.3' }]);
    prisma.activityLog.count.mockResolvedValue(1);
    const res = mockRes();
    await controller.exportCsv({ params: { kind: 'activity' }, query: { outcome: 'success' }, user: { type: 'staff', id: 1 } }, res);

    expect(res.send.mock.calls[0][0]).toContain('Vacancy approved');
    expect(res.send.mock.calls[0][0]).toContain('10.1.2.3');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'AuditLog', action: 'Exported the activity log', payload: expect.objectContaining({ rows: 1, filters: { outcome: 'success' } })
    }) });
  });
});
