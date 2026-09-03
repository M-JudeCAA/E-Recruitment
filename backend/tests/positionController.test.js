jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const positionController = require('../src/controllers/positionController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('create', () => {
  test('rejects a missing name', async () => {
    const req = { body: { name: '', departmentId: '1', level: 1 }, user: { id: 1 } };
    const res = mockRes();
    await positionController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('rejects a department that does not exist', async () => {
    prisma.department.findUnique.mockResolvedValue(null);
    const req = { body: { name: 'CWG Officer', departmentId: '999', level: 1 }, user: { id: 1 } };
    const res = mockRes();
    await positionController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a department that is not yet Approved', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Pending' });
    const req = { body: { name: 'CWG Officer', departmentId: '1', level: 1 }, user: { id: 1 } };
    const res = mockRes();
    await positionController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('rejects a non-integer level', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Approved' });
    const req = { body: { name: 'CWG Officer', departmentId: '1', level: 1.5 }, user: { id: 1 } };
    const res = mockRes();
    await positionController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('creates a position for a valid, approved department', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Approved' });
    prisma.position.create.mockResolvedValue({ id: 1, name: 'CWG Officer' });
    const req = { body: { name: '  CWG Officer  ', departmentId: '1', level: 2 }, user: { id: 1 } };
    const res = mockRes();

    await positionController.create(req, res);

    expect(prisma.position.create).toHaveBeenCalledWith({
      data: { name: 'CWG Officer', departmentId: 1, level: 2, createdById: 1 }
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('returns 409 on a duplicate (name, department) pair', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 1, status: 'Approved' });
    prisma.position.create.mockRejectedValue(new Error('Unique constraint failed'));
    const req = { body: { name: 'CWG Officer', departmentId: '1', level: 1 }, user: { id: 1 } };
    const res = mockRes();

    await positionController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('listSeniorOptions', () => {
  test('returns 404 when the position does not exist', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await positionController.listSeniorOptions({ params: { id: '99' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('scopes the senior-options query to the position\'s own department and level', async () => {
    prisma.position.findUnique.mockResolvedValue({ id: 100, departmentId: 1, level: 1 });
    prisma.position.findMany.mockResolvedValue([]);
    const res = mockRes();

    await positionController.listSeniorOptions({ params: { id: '100' } }, res);

    expect(prisma.position.findMany).toHaveBeenCalledWith({
      where: { departmentId: 1, level: { gt: 1 } },
      orderBy: { level: 'asc' }
    });
  });
});

describe('listByDepartment', () => {
  test('scopes positions to the given department only', async () => {
    prisma.position.findMany.mockResolvedValue([]);
    const res = mockRes();

    await positionController.listByDepartment({ params: { id: '1' } }, res);

    expect(prisma.position.findMany).toHaveBeenCalledWith({
      where: { departmentId: 1 },
      orderBy: { level: 'asc' }
    });
  });
});
