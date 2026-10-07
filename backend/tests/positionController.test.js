jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const positionController = require('../src/controllers/positionController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const hro = { id: 1, role: 'HR_Officer' };
const phro = { id: 3, role: 'Principal_HR_Officer' };
const approvedDept = { id: 1, status: 'Approved', directorate: { id: 10, status: 'Approved' } };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.delegation.findFirst.mockResolvedValue(null);
});

describe('create', () => {
  test('rejects a missing name', async () => {
    const res = mockRes();
    await positionController.create({ body: { name: '', departmentId: '1', level: 1 }, user: hro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('rejects a department that does not exist', async () => {
    prisma.department.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await positionController.create({ body: { name: 'CWG Officer', departmentId: '999', level: 1 }, user: hro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a department that is not yet Approved', async () => {
    prisma.department.findUnique.mockResolvedValue({ ...approvedDept, status: 'Pending' });
    const res = mockRes();
    await positionController.create({ body: { name: 'CWG Officer', departmentId: '1', level: 1 }, user: hro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('rejects a department whose directorate is not Approved', async () => {
    prisma.department.findUnique.mockResolvedValue({ ...approvedDept, directorate: { id: 10, status: 'Pending' } });
    const res = mockRes();
    await positionController.create({ body: { name: 'CWG Officer', departmentId: '1', level: 1 }, user: hro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('rejects a non-integer level', async () => {
    prisma.department.findUnique.mockResolvedValue(approvedDept);
    const res = mockRes();
    await positionController.create({ body: { name: 'CWG Officer', departmentId: '1', level: 1.5 }, user: hro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('an HR Officer\'s position waits for approval, audited as sent for approval', async () => {
    prisma.department.findUnique.mockResolvedValue(approvedDept);
    prisma.position.create.mockResolvedValue({ id: 1, name: 'CWG Officer', status: 'Pending' });
    const res = mockRes();

    await positionController.create({ body: { name: '  CWG Officer  ', departmentId: '1', level: 2 }, user: hro }, res);

    expect(prisma.position.create).toHaveBeenCalledWith({
      data: { name: 'CWG Officer', departmentId: 1, level: 2, createdById: 1, status: 'Pending' }
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      entityType: 'Position', entityId: 1, action: 'Created, sent for approval'
    }));
  });

  test('a Principal HR Officer\'s position is approved at once unless "Approve now" is unticked', async () => {
    prisma.department.findUnique.mockResolvedValue(approvedDept);
    prisma.position.create.mockResolvedValue({ id: 2, name: 'CWG Officer', status: 'Approved' });

    await positionController.create({ body: { name: 'CWG Officer', departmentId: '1', level: 2 }, user: phro }, mockRes());
    expect(prisma.position.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ status: 'Approved', approvedById: 3 }));
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('Created and approved (Approve now)');

    await positionController.create({ body: { name: 'CWG Analyst', departmentId: '1', level: 1, autoApprove: 'false' }, user: phro }, mockRes());
    expect(prisma.position.create.mock.calls[1][0].data).toEqual(expect.objectContaining({ status: 'Pending' }));
    expect(prisma.auditLog.create.mock.calls[1][0].data.action).toBe('Created, sent for approval');
  });

  test('returns 409 on a duplicate (name, department) pair', async () => {
    prisma.department.findUnique.mockResolvedValue(approvedDept);
    prisma.position.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const res = mockRes();

    await positionController.create({ body: { name: 'CWG Officer', departmentId: '1', level: 1 }, user: hro }, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('approve / reject', () => {
  const pending = { id: 5, name: 'CWG Officer', status: 'Pending', createdById: 1, departmentId: 1 };

  test('a Principal HR Officer approves another\'s position', async () => {
    prisma.position.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, status: 'Approved' });
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Approved' });
    prisma.position.updateMany.mockResolvedValue({ count: 1 });

    await positionController.approve({ params: { id: '5' }, user: phro }, mockRes());

    expect(prisma.position.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: 'Pending' }, data: expect.objectContaining({ status: 'Approved', approvedById: 3 })
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ entityType: 'Position', action: 'Approved' }));
  });

  test('nobody approves their own position', async () => {
    prisma.position.findUnique.mockResolvedValue({ ...pending, createdById: 3 });
    await expect(positionController.approve({ params: { id: '5' }, user: phro }, mockRes()))
      .rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL' });
  });

  test('reject needs a reason', async () => {
    prisma.position.findUnique.mockResolvedValue(pending);
    await expect(positionController.reject({ params: { id: '5' }, body: { reason: ' ' }, user: phro }, mockRes()))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('listSeniorOptions', () => {
  test('returns 404 when the position does not exist', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await positionController.listSeniorOptions({ params: { id: '99' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('scopes the senior-options query to approved positions in the position\'s own department and level', async () => {
    prisma.position.findUnique.mockResolvedValue({ id: 100, departmentId: 1, level: 1 });
    prisma.position.findMany.mockResolvedValue([]);

    await positionController.listSeniorOptions({ params: { id: '100' } }, mockRes());

    expect(prisma.position.findMany).toHaveBeenCalledWith({
      where: { departmentId: 1, level: { gt: 1 }, status: 'Approved' },
      orderBy: { level: 'asc' }
    });
  });
});

describe('listByDepartment', () => {
  test('scopes positions to the given department, approved only', async () => {
    prisma.position.findMany.mockResolvedValue([]);

    await positionController.listByDepartment({ params: { id: '1' } }, mockRes());

    expect(prisma.position.findMany).toHaveBeenCalledWith({
      where: { departmentId: 1, status: 'Approved' },
      orderBy: { level: 'asc' }
    });
  });
});
