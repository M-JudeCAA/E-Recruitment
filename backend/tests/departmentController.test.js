jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const departmentController = require('../src/controllers/departmentController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('propose', () => {
  test('rejects a missing name', async () => {
    const req = { body: { name: '  ', directorateId: '1' }, user: { id: 1 } };
    const res = mockRes();
    await departmentController.propose(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid directorateId', async () => {
    prisma.directorate.findUnique.mockResolvedValue(null);
    const req = { body: { name: 'CWG', directorateId: '999' }, user: { id: 1 } };
    const res = mockRes();
    await departmentController.propose(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });

  test('creates a Pending department for a valid directorate', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP' });
    prisma.department.findFirst.mockResolvedValue(null); // no existing duplicate
    prisma.department.create.mockResolvedValue({ id: 1, name: 'CWG', status: 'Pending' });
    const req = { body: { name: '  CWG  ', directorateId: '10' }, user: { id: 1 } };
    const res = mockRes();

    await departmentController.propose(req, res);

    expect(prisma.department.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: 'CWG', directorateId: 10, status: 'Pending', createdById: 1 }
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('returns 409 on a duplicate (name, directorate) pair, checked explicitly before create', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 10, name: 'CORP' });
    prisma.department.findFirst.mockResolvedValue({ id: 5, name: 'CWG', directorateId: 10 });
    const req = { body: { name: 'CWG', directorateId: '10' }, user: { id: 1 } };
    const res = mockRes();

    await departmentController.propose(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.department.create).not.toHaveBeenCalled();
  });
});

describe('approve / reject', () => {
  test('approve returns 404 when the department does not exist', async () => {
    prisma.department.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await departmentController.approve({ params: { id: '99' }, user: { id: 2 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('approve returns 422 when the department is not Pending', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Approved' });
    const res = mockRes();
    await departmentController.approve({ params: { id: '1' }, user: { id: 2 } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.department.update).not.toHaveBeenCalled();
  });

  test('approve sets status Approved with approver and timestamp', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Pending' });
    prisma.department.update.mockResolvedValue({ id: 1, status: 'Approved' });
    const res = mockRes();

    await departmentController.approve({ params: { id: '1' }, user: { id: 2 } }, res);

    expect(prisma.department.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'Approved', approvedById: 2, rejectionReason: null })
    }));
  });

  test('reject requires a reason - rejects with 400 when missing', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Pending' });
    const res = mockRes();

    await departmentController.reject({ params: { id: '1' }, body: {}, user: { id: 2 } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.department.update).not.toHaveBeenCalled();
  });

  test('reject sets status Rejected with the given reason', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Pending' });
    prisma.department.update.mockResolvedValue({ id: 1, status: 'Rejected' });
    const res = mockRes();

    await departmentController.reject({ params: { id: '1' }, body: { reason: 'Duplicate of an existing department' }, user: { id: 2 } }, res);

    expect(prisma.department.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'Rejected', approvedById: 2, rejectionReason: 'Duplicate of an existing department' })
    }));
  });
});
