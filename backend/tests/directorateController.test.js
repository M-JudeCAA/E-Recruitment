jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const directorateController = require('../src/controllers/directorateController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const phro = { id: 3, role: 'Principal_HR_Officer' };
const hro = { id: 1, role: 'HR_Officer' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.delegation.findFirst.mockResolvedValue(null);
  prisma.directorate.findFirst.mockResolvedValue(null);
});

describe('create', () => {
  test('needs a short code and a full name', async () => {
    let res = mockRes();
    await directorateController.create({ body: { code: 'NEW', name: '   ' }, user: phro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/full name/) });

    res = mockRes();
    await directorateController.create({ body: { name: 'New Directorate' }, user: phro }, res);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/short code/) });

    res = mockRes();
    await directorateController.create({ body: { code: 'N*W', name: 'New Directorate' }, user: phro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.directorate.create).not.toHaveBeenCalled();
  });

  test('rejects a code or a name that already exists', async () => {
    prisma.directorate.findUnique.mockResolvedValueOnce({ id: 1, code: 'CORP' });
    let res = mockRes();
    await directorateController.create({ body: { code: 'corp', name: 'Corporate' }, user: phro }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/code CORP/) });

    prisma.directorate.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 1, name: 'Corporate' });
    res = mockRes();
    await directorateController.create({ body: { code: 'CO', name: 'Corporate' }, user: phro }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.directorate.create).not.toHaveBeenCalled();
  });

  test('creates an approved directorate by default ("Approve now"), code upper-cased, with optional director contact fields, audited', async () => {
    prisma.directorate.findUnique.mockResolvedValue(null);
    prisma.directorate.create.mockResolvedValue({ id: 7, code: 'NEWDIR', name: 'New Directorate', status: 'Approved' });
    const res = mockRes();

    await directorateController.create({
      body: { code: ' newdir ', name: '  New   Directorate ', directorName: 'Jane Doe', directorEmail: 'jane@caa.co.ug' }, user: phro
    }, res);

    expect(prisma.directorate.create).toHaveBeenCalledWith({
      data: {
        code: 'NEWDIR', name: 'New Directorate', directorName: 'Jane Doe', directorEmail: 'jane@caa.co.ug', createdById: 3,
        status: 'Approved', approvedById: 3, approvedAt: expect.any(Date)
      }
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'Directorate', entityId: 7, action: 'Created and approved (Approve now)', performedById: 3,
        payload: expect.objectContaining({ autoApproved: true, name: 'New Directorate', code: 'NEWDIR' })
      })
    });
  });

  test('"Approve now" unticked leaves it Pending for another Principal HR Officer', async () => {
    prisma.directorate.findUnique.mockResolvedValue(null);
    prisma.directorate.create.mockResolvedValue({ id: 8, code: 'NEWDIR', name: 'New Directorate', status: 'Pending' });

    await directorateController.create({ body: { code: 'NEWDIR', name: 'New Directorate', autoApprove: false }, user: phro }, mockRes());

    expect(prisma.directorate.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ status: 'Pending' }));
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('Created, sent for approval');
  });
});

describe('approve / reject', () => {
  test('nobody approves their own directorate', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 8, name: 'NEWDIR', status: 'Pending', createdById: 3 });
    await expect(directorateController.approve({ params: { id: '8' }, user: phro }, mockRes()))
      .rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL' });
  });

  test('another Principal HR Officer approves it', async () => {
    prisma.directorate.findUnique
      .mockResolvedValueOnce({ id: 8, name: 'NEWDIR', status: 'Pending', createdById: 3 })
      .mockResolvedValueOnce({ id: 8, name: 'NEWDIR', status: 'Approved' });
    prisma.directorate.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();

    await directorateController.approve({ params: { id: '8' }, user: { id: 4, role: 'Manager' } }, res);

    expect(prisma.directorate.updateMany).toHaveBeenCalledWith({
      where: { id: 8, status: 'Pending' }, data: expect.objectContaining({ status: 'Approved', approvedById: 4 })
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ entityType: 'Directorate', action: 'Approved', performedById: 4 }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'Approved' }));
  });
});

describe('list', () => {
  test('returns every directorate with how many departments and positions it has', async () => {
    prisma.directorate.findMany.mockResolvedValue([{
      id: 1, code: 'CORP', name: 'Corporate',
      departments: [{ status: 'Approved', _count: { positions: 3 } }, { status: 'Pending', _count: { positions: 0 } }]
    }]);
    const res = mockRes();
    await directorateController.list({}, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, code: 'CORP', name: 'Corporate', departmentCount: 2, positionCount: 3 }]);
    expect(prisma.directorate.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { code: 'asc' } }));
  });
});

describe('update', () => {
  const approved = { id: 5, code: 'DF', name: 'Finance', status: 'Approved', createdById: 9, directorName: null, directorEmail: null };

  test('a Principal HR Officer renames it and sets the director; the change is audited', async () => {
    prisma.directorate.findUnique.mockResolvedValue(approved);
    prisma.directorate.update.mockResolvedValue({ ...approved, name: 'Finance Directorate', directorName: 'Ann' });
    const res = mockRes();

    await directorateController.update({ params: { id: '5' }, body: { code: 'df', name: 'Finance Directorate', directorName: 'Ann' }, user: phro }, res);

    expect(prisma.directorate.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { code: 'DF', name: 'Finance Directorate', directorName: 'Ann' } });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      entityType: 'Directorate', entityId: 5, action: 'Edited', performedById: 3,
      payload: expect.objectContaining({ changes: { name: { from: 'Finance', to: 'Finance Directorate' }, directorName: { from: null, to: 'Ann' } } })
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'Finance Directorate' }));
  });

  test('refuses a code another directorate has', async () => {
    prisma.directorate.findUnique.mockResolvedValue(approved);
    prisma.directorate.findFirst.mockResolvedValueOnce({ id: 6 });
    await expect(directorateController.update({ params: { id: '5' }, body: { code: 'DHRA' }, user: phro }, mockRes()))
      .rejects.toMatchObject({ status: 409, code: 'ORG_DUPLICATE' });
    expect(prisma.directorate.findFirst).toHaveBeenCalledWith({ where: { code: 'DHRA', NOT: { id: 5 } }, select: { id: true } });
    expect(prisma.directorate.update).not.toHaveBeenCalled();
  });

  test('an HR Officer cannot edit an approved directorate', async () => {
    prisma.directorate.findUnique.mockResolvedValue(approved);
    await expect(directorateController.update({ params: { id: '5' }, body: { name: 'X' }, user: hro }, mockRes()))
      .rejects.toMatchObject({ status: 403, code: 'ORG_EDIT_NOT_ALLOWED' });
  });

  test('a rejected directorate cannot be edited', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ ...approved, status: 'Rejected' });
    await expect(directorateController.update({ params: { id: '5' }, body: { name: 'X' }, user: phro }, mockRes()))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe('remove', () => {
  test('refused while it has departments', async () => {
    prisma.directorate.findUnique
      .mockResolvedValueOnce({ id: 5, code: 'DF', name: 'Finance', status: 'Approved', createdById: 9 })
      .mockResolvedValueOnce({ _count: { departments: 2 } });
    await expect(directorateController.remove({ params: { id: '5' }, body: {}, user: phro }, mockRes()))
      .rejects.toMatchObject({ status: 409, code: 'ORG_IN_USE', message: expect.stringMatching(/2 department/) });
    expect(prisma.directorate.delete).not.toHaveBeenCalled();
  });

  test('deletes an unused one, closes its approval deadline and audits it with the reason', async () => {
    prisma.directorate.findUnique
      .mockResolvedValueOnce({ id: 5, code: 'DX', name: 'Duplicate', status: 'Pending', createdById: 9 })
      .mockResolvedValueOnce({ _count: { departments: 0 } });
    const res = mockRes();

    await directorateController.remove({ params: { id: '5' }, body: { reason: 'Added twice' }, user: phro }, res);

    expect(prisma.directorate.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ taskType: 'DirectorateApproval', taskId: 5 }) }));
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      entityType: 'Directorate', entityId: 5, action: 'Deleted',
      payload: expect.objectContaining({ comment: 'Added twice', code: 'DX', name: 'Duplicate' })
    }));
    expect(res.json).toHaveBeenCalledWith({ deleted: true, id: 5 });
  });
});
