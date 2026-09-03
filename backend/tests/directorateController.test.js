jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const directorateController = require('../src/controllers/directorateController');

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
    const req = { body: { name: '   ' }, user: { id: 1 } };
    const res = mockRes();
    await directorateController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.directorate.create).not.toHaveBeenCalled();
  });

  test('rejects a name that already exists', async () => {
    prisma.directorate.findUnique.mockResolvedValue({ id: 1, name: 'CORP' });
    const req = { body: { name: 'CORP' }, user: { id: 1 } };
    const res = mockRes();
    await directorateController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.directorate.create).not.toHaveBeenCalled();
  });

  test('creates a directorate with optional director contact fields', async () => {
    prisma.directorate.findUnique.mockResolvedValue(null);
    prisma.directorate.create.mockResolvedValue({ id: 7, name: 'NEWDIR' });
    const req = {
      body: { name: '  NEWDIR  ', directorName: 'Jane Doe', directorEmail: 'jane@caa.co.ug' },
      user: { id: 1 }
    };
    const res = mockRes();

    await directorateController.create(req, res);

    expect(prisma.directorate.create).toHaveBeenCalledWith({
      data: { name: 'NEWDIR', directorName: 'Jane Doe', directorEmail: 'jane@caa.co.ug', createdById: 1 }
    });
    expect(res.status).toHaveBeenCalledWith(201);
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
