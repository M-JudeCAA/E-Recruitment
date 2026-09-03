jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const vacancyController = require('../src/controllers/vacancyController');

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
  test('rejects invalid input with 400 and never touches the database', async () => {
    const req = { body: { title: '', department: 'AVSEC' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('trims strings, defaults positionsRequired to 1, and creates the vacancy', async () => {
    prisma.vacancy.create.mockResolvedValue({ id: 1, title: 'AVSEC Officer' });
    const req = {
      body: { title: '  AVSEC Officer  ', department: '  AVSEC  ' },
      user: { id: 7 }
    };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(prisma.vacancy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'AVSEC Officer', department: 'AVSEC', positionsRequired: 1,
        postingType: 'Open', createdById: 7
      })
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('update', () => {
  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const req = { params: { id: '99' }, body: { title: 'New title' } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('rejects invalid input with 400 in partial mode', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2 });
    const req = { params: { id: '1' }, body: { postingType: 'Bogus' } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('applies only the fields present in the payload', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2 });
    prisma.vacancy.update.mockResolvedValue({ id: 1, title: 'Updated title' });
    const req = { params: { id: '1' }, body: { title: '  Updated title  ' } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { title: 'Updated title' }
    });
    expect(res.json).toHaveBeenCalledWith({ id: 1, title: 'Updated title' });
  });

  test('rejects reducing positionsRequired below the number of accepted offers', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 3 });
    prisma.offer.count.mockResolvedValue(2);
    const req = { params: { id: '1' }, body: { positionsRequired: 1 } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('allows reducing positionsRequired to no less than the accepted-offer count', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 3 });
    prisma.offer.count.mockResolvedValue(2);
    prisma.vacancy.update.mockResolvedValue({ id: 1, positionsRequired: 2 });
    const req = { params: { id: '1' }, body: { positionsRequired: 2 } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { positionsRequired: 2 }
    });
  });
});

describe('close', () => {
  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const req = { params: { id: '99' } };
    const res = mockRes();

    await vacancyController.close(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 422 if the vacancy is already closed', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Closed' });
    const req = { params: { id: '1' } };
    const res = mockRes();

    await vacancyController.close(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('transitions an open vacancy to Closed', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open' });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Closed' });
    const req = { params: { id: '1' } };
    const res = mockRes();

    await vacancyController.close(req, res);

    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { status: 'Closed' }
    });
    expect(res.json).toHaveBeenCalledWith({ id: 1, status: 'Closed' });
  });
});

describe('listPublic', () => {
  test('shows Internal-only postings to a verified Internal candidate token', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    const req = { user: { type: 'candidate', candidateType: 'Internal' } };
    const res = mockRes();

    await vacancyController.listPublic(req, res);

    expect(prisma.vacancy.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['Open', 'PartiallyFilled'] } },
      orderBy: { createdAt: 'desc' }
    });
  });

  test('hides Internal-only postings from an anonymous request (no token)', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    const req = { user: undefined };
    const res = mockRes();

    await vacancyController.listPublic(req, res);

    expect(prisma.vacancy.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['Open', 'PartiallyFilled'] },
        postingType: { in: ['External', 'Open'] }
      },
      orderBy: { createdAt: 'desc' }
    });
  });

  test('hides Internal-only postings from a staff token (not a candidate)', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    const req = { user: { type: 'staff', role: 'HR_Officer' } };
    const res = mockRes();

    await vacancyController.listPublic(req, res);

    expect(prisma.vacancy.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['Open', 'PartiallyFilled'] },
        postingType: { in: ['External', 'Open'] }
      },
      orderBy: { createdAt: 'desc' }
    });
  });
});
