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

beforeEach(() => {
  jest.clearAllMocks();
  prisma.delegation.findFirst.mockResolvedValue(null);
});

describe('create', () => {
  test('rejects a missing name', async () => {
    const res = mockRes();
    await directorateController.create({ body: { name: '   ' }, user: phro }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.directorate.create).not.toHaveBeenCalled();
  });

  test('rejects a name that already exists', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 1, name: 'CORP' });
    const res = mockRes();
    await directorateController.create({ body: { name: 'CORP' }, user: phro }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.directorate.create).not.toHaveBeenCalled();
  });

  test('creates an approved directorate by default ("Approve now"), with optional director contact fields, audited', async () => {
    prisma.directorate.findUnique.mockResolvedValue(null);
    prisma.directorate.create.mockResolvedValue({ id: 7, name: 'NEWDIR', status: 'Approved' });
    const res = mockRes();

    await directorateController.create({
      body: { name: '  NEWDIR  ', directorName: 'Jane Doe', directorEmail: 'jane@caa.co.ug' }, user: phro
    }, res);

    expect(prisma.directorate.create).toHaveBeenCalledWith({
      data: {
        name: 'NEWDIR', directorName: 'Jane Doe', directorEmail: 'jane@caa.co.ug', createdById: 3,
        status: 'Approved', approvedById: 3, approvedAt: expect.any(Date)
      }
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'Directorate', entityId: 7, action: 'Created and approved (Approve now)', performedById: 3,
        payload: expect.objectContaining({ autoApproved: true, name: 'NEWDIR' })
      })
    });
  });

  test('"Approve now" unticked leaves it Pending for another Principal HR Officer', async () => {
    prisma.directorate.findUnique.mockResolvedValue(null);
    prisma.directorate.create.mockResolvedValue({ id: 8, name: 'NEWDIR', status: 'Pending' });

    await directorateController.create({ body: { name: 'NEWDIR', autoApprove: false }, user: phro }, mockRes());

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
  test('returns all directorates', async () => {
    prisma.directorate.findMany.mockResolvedValue([{ id: 1, name: 'CORP' }]);
    const res = mockRes();
    await directorateController.list({}, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, name: 'CORP' }]);
  });
});
