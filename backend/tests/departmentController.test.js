jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const departmentController = require('../src/controllers/departmentController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const hro = { id: 1, role: 'HR_Officer' };
const phro = { id: 3, role: 'Principal_HR_Officer' };
const auditActions = () => prisma.auditLog.create.mock.calls.map(([arg]) => arg.data);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.delegation.findFirst.mockResolvedValue(null);
});

describe('propose', () => {
  test('rejects a missing name', async () => {
    const req = { body: { name: '  ', directorateId: '1' }, user: hro };
    const res = mockRes();
    await departmentController.propose(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid directorateId', async () => {
    prisma.directorate.findUnique.mockResolvedValue(null);
    const req = { body: { name: 'CWG', directorateId: '999' }, user: hro };
    const res = mockRes();
    await departmentController.propose(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  test('refuses a rejected directorate', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP', status: 'Rejected' });
    const res = mockRes();
    await departmentController.propose({ body: { name: 'CWG', directorateId: '10' }, user: phro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  test('an HR Officer\'s department is Pending, and the audit log says it was sent for approval', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP', status: 'Approved' });
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.department.create.mockResolvedValue({ id: 1, name: 'CWG', status: 'Pending' });
    const res = mockRes();

    // autoApprove is ignored below Principal HR Officer.
    await departmentController.propose({ body: { name: '  CWG  ', directorateId: '10', autoApprove: true }, user: hro }, res);

    expect(prisma.department.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: 'CWG', directorateId: 10, createdById: 1, status: 'Pending' }
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ autoApproved: false }));
    expect(auditActions()).toEqual([expect.objectContaining({
      entityType: 'Department', entityId: 1, action: 'Created, sent for approval', performedById: 1,
      payload: expect.objectContaining({ autoApproved: false, autoApproveAvailable: false })
    })]);
  });

  test('a Principal HR Officer\'s department is approved at once by default ("Approve now")', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP', status: 'Approved' });
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.department.create.mockResolvedValue({ id: 2, name: 'CWG', status: 'Approved' });
    const res = mockRes();

    await departmentController.propose({ body: { name: 'CWG', directorateId: '10' }, user: phro }, res);

    expect(prisma.department.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Approved', approvedById: 3, approvedAt: expect.any(Date) })
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ autoApproved: true }));
    const [entry] = auditActions();
    expect(entry).toEqual(expect.objectContaining({ action: 'Created and approved (Approve now)', performedById: 3 }));
    expect(entry.payload).toEqual(expect.objectContaining({ autoApproved: true, comment: expect.stringMatching(/Approve now/) }));
  });

  test('a Principal HR Officer who unticks "Approve now" sends it for approval', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP', status: 'Approved' });
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.department.create.mockResolvedValue({ id: 3, name: 'CWG', status: 'Pending' });
    const res = mockRes();

    await departmentController.propose({ body: { name: 'CWG', directorateId: '10', autoApprove: false }, user: phro }, res);

    expect(prisma.department.create.mock.calls[0][0].data.status).toBe('Pending');
    expect(prisma.department.create.mock.calls[0][0].data.approvedById).toBeUndefined();
    expect(auditActions()[0]).toEqual(expect.objectContaining({
      action: 'Created, sent for approval',
      payload: expect.objectContaining({ autoApproved: false, autoApproveAvailable: true, comment: expect.stringMatching(/unticked/) })
    }));
  });

  test('a Senior HR Officer acting for a Principal HR Officer can approve at once, and the delegation is logged', async () => {
    prisma.delegation.findFirst.mockResolvedValue({ id: 9, delegatorId: 7, delegator: { role: 'Principal_HR_Officer' } });
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP', status: 'Approved' });
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.department.create.mockResolvedValue({ id: 4, name: 'CWG', status: 'Approved' });

    await departmentController.propose({ method: 'POST', originalUrl: '/api/departments', body: { name: 'CWG', directorateId: '10' }, user: { id: 2, role: 'Senior_HR_Officer' } }, mockRes());

    expect(prisma.department.create.mock.calls[0][0].data.status).toBe('Approved');
    expect(prisma.delegationUsage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ delegationId: 9 }) });
    expect(auditActions()[0]).toEqual(expect.objectContaining({ performedById: 2, actingAsId: 7 }));
  });

  test('returns 409 on a duplicate (name, directorate) pair, checked explicitly before create', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP', status: 'Approved' });
    prisma.department.findFirst.mockResolvedValue({ id: 5, name: 'CWG', directorateId: 10 });
    const res = mockRes();

    await departmentController.propose({ body: { name: 'CWG', directorateId: '10' }, user: hro }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });
});

describe('approve / reject', () => {
  const pending = { id: 1, name: 'CWG', status: 'Pending', createdById: 1, directorateId: 10 };

  test('approve answers 404 when the department does not exist', async () => {
    prisma.department.findUnique.mockResolvedValue(null);
    await expect(departmentController.approve({ params: { id: '99' }, user: phro }, mockRes())).rejects.toMatchObject({ status: 404 });
  });

  test('approve answers 422 when the department is not Pending', async () => {
    prisma.department.findUnique.mockResolvedValue({ ...pending, status: 'Approved' });
    await expect(departmentController.approve({ params: { id: '1' }, user: phro }, mockRes())).rejects.toMatchObject({ status: 422 });
    expect(prisma.department.updateMany).not.toHaveBeenCalled();
  });

  test('nobody approves their own department (403 SELF_APPROVAL)', async () => {
    prisma.department.findUnique.mockResolvedValue({ ...pending, createdById: 3 });
    await expect(departmentController.approve({ params: { id: '1' }, user: phro }, mockRes()))
      .rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL' });
    expect(prisma.department.updateMany).not.toHaveBeenCalled();
  });

  test('approve is refused under a rejected directorate', async () => {
    prisma.department.findUnique.mockResolvedValue(pending);
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, status: 'Rejected' });
    await expect(departmentController.approve({ params: { id: '1' }, user: phro }, mockRes())).rejects.toMatchObject({ status: 422 });
  });

  test('approve sets status Approved only while still Pending, audits it and clears the SLA task', async () => {
    prisma.department.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, status: 'Approved' });
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, status: 'Approved' });
    prisma.department.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();

    await departmentController.approve({ params: { id: '1' }, user: phro }, res);

    expect(prisma.department.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'Pending' },
      data: expect.objectContaining({ status: 'Approved', approvedById: 3, rejectionReason: null })
    });
    expect(auditActions()).toEqual([expect.objectContaining({
      entityType: 'Department', entityId: 1, action: 'Approved', performedById: 3,
      payload: expect.objectContaining({ changes: { status: { from: 'Pending', to: 'Approved' } } })
    })]);
    expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith({
      where: { taskType: 'DepartmentApproval', taskId: 1, resolvedAt: null },
      data: { resolvedAt: expect.any(Date) }
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'Approved' }));
  });

  test('approve answers 409 when someone else decided it first', async () => {
    prisma.department.findUnique.mockResolvedValue(pending);
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, status: 'Approved' });
    prisma.department.updateMany.mockResolvedValue({ count: 0 });
    await expect(departmentController.approve({ params: { id: '1' }, user: phro }, mockRes())).rejects.toMatchObject({ status: 409 });
  });

  test('reject requires a reason', async () => {
    prisma.department.findUnique.mockResolvedValue(pending);
    await expect(departmentController.reject({ params: { id: '1' }, body: {}, user: phro }, mockRes())).rejects.toMatchObject({ status: 400 });
    expect(prisma.department.updateMany).not.toHaveBeenCalled();
  });

  test('reject sets status Rejected with the reason, audited with it as the comment', async () => {
    prisma.department.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, status: 'Rejected', rejectionReason: 'Duplicate' });
    prisma.department.updateMany.mockResolvedValue({ count: 1 });

    await departmentController.reject({ params: { id: '1' }, body: { reason: 'Duplicate' }, user: phro }, mockRes());

    expect(prisma.department.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'Pending' },
      data: expect.objectContaining({ status: 'Rejected', approvedById: 3, rejectionReason: 'Duplicate' })
    });
    expect(auditActions()[0]).toEqual(expect.objectContaining({ action: 'Rejected', payload: expect.objectContaining({ comment: 'Duplicate' }) }));
    expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith({
      where: { taskType: 'DepartmentApproval', taskId: 1, resolvedAt: null },
      data: { resolvedAt: expect.any(Date) }
    });
  });
});
