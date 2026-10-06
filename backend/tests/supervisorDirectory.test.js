jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const directory = require('../src/services/directoryService');
const directoryController = require('../src/controllers/directoryController');
const candidateController = require('../src/controllers/candidateController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const internal = { id: 7, type: 'candidate', candidateType: 'Internal' };
const people = [
  { entraObjectId: 'a', name: 'Ben Tumwine', email: 'ben.tumwine@caa.co.ug', jobTitle: 'Manager IT', department: 'IT' },
  { entraObjectId: 'b', name: 'Patrick Ocen', email: 'patrick.ocen@caa.co.ug', jobTitle: 'Systems Officer', department: 'IT' }
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('internal candidates searching for their supervisor', () => {
  test('finds colleagues, leaving themselves out', async () => {
    jest.spyOn(directory, 'isConfigured').mockReturnValue(true);
    jest.spyOn(directory, 'searchPeople').mockResolvedValue(people);
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'Patrick.Ocen@caa.co.ug' });
    const res = mockRes();
    await directoryController.searchColleagues({ user: internal, query: { q: 'tum' } }, res);
    expect(directory.searchPeople).toHaveBeenCalledWith('tum');
    expect(res.json).toHaveBeenCalledWith([people[0]]);
  });

  test('is for internal candidates only', async () => {
    const res = mockRes();
    await directoryController.searchColleagues({ user: { ...internal, candidateType: 'External' }, query: { q: 'tum' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('says when the directory is not connected, so the page lets them type', async () => {
    jest.spyOn(directory, 'isConfigured').mockReturnValue(false);
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'patrick.ocen@caa.co.ug' });
    const res = mockRes();
    await directoryController.searchColleagues({ user: internal, query: { q: 'tum' } }, res);
    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DIRECTORY_NOT_CONFIGURED' }));
  });
});

describe('the supervisor email on the internal profile', () => {
  const body = {
    employeeId: 'UCAA/2017/0412', department: 'IT', position: 'Systems Officer',
    dateJoined: '2017-03-01', supervisorName: 'Ben Tumwine'
  };
  const realDomain = process.env.INTERNAL_EMAIL_DOMAIN;
  beforeEach(() => {
    process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
    prisma.internalProfile.findUnique.mockResolvedValue(null);
    prisma.internalProfile.update.mockImplementation(({ data }) => Promise.resolve({ ...data }));
  });
  afterAll(() => { process.env.INTERNAL_EMAIL_DOMAIN = realDomain; });

  test('must be a UCAA address', async () => {
    const res = mockRes();
    await candidateController.updateInternalProfile({ user: internal, body: { ...body, supervisorEmail: 'ben@gmail.com' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUPERVISOR_NOT_UCAA' }));
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test('is stored in lower case', async () => {
    await candidateController.updateInternalProfile({ user: internal, body: { ...body, supervisorEmail: ' Ben.Tumwine@CAA.co.ug ' } }, mockRes());
    expect(prisma.internalProfile.update.mock.calls[0][0].data.supervisorEmail).toBe('ben.tumwine@caa.co.ug');
  });
});
