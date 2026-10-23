jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const candidateController = require('../src/controllers/candidateController');
const { getMissingProfileFields } = require('../src/utils/profileCompleteness');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const internal = { id: 7, type: 'candidate', candidateType: 'Internal' };
const approved = { status: 'Approved', directorateId: 1, directorate: { status: 'Approved' } };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.internalProfile.findUnique.mockResolvedValue(null);
  prisma.internalProfile.update.mockImplementation(({ data }) => Promise.resolve({ ...data }));
  prisma.position.findUnique.mockResolvedValue({ id: 40, name: 'Systems Officer', departmentId: 4, status: 'Approved', department: { id: 4, name: 'IT', ...approved } });
});

describe('the internal profile', () => {
  const body = { employeeId: ' UCAA/2017/0412 ', departmentId: 4, positionId: 40, dateJoined: '2017-03-01' };

  test('needs the employee number', async () => {
    const res = mockRes();
    await candidateController.updateInternalProfile({ user: internal, body: { ...body, employeeId: '  ' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMPLOYEE_NUMBER_REQUIRED' }));
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test('keeps no supervisor, even when one is sent', async () => {
    await candidateController.updateInternalProfile({
      user: internal, body: { ...body, supervisorName: 'Ben Tumwine', supervisorEmail: 'ben@caa.co.ug' }
    }, mockRes());
    const { data } = prisma.internalProfile.update.mock.calls[0][0];
    expect(data.employeeId).toBe('UCAA/2017/0412');
    expect(data).not.toHaveProperty('supervisorName');
    expect(data).not.toHaveProperty('supervisorEmail');
  });
});

describe('profile completeness', () => {
  const entries = { location: 'Entebbe', districtOfOrigin: 'Wakiso', education: [{}], workExperience: [{}] };
  const profile = { employeeId: 'E1', department: 'IT', position: 'Systems Officer', dateJoined: '2017-03-01' };

  test('an internal candidate needs no National ID and no supervisor', () => {
    expect(getMissingProfileFields({ ...entries, candidateType: 'Internal', internalProfile: profile })).toEqual([]);
  });

  test('an internal candidate needs their employee number', () => {
    expect(getMissingProfileFields({ ...entries, candidateType: 'Internal', internalProfile: { ...profile, employeeId: null } }))
      .toEqual(['internalProfile.employeeId']);
  });

  test('an external candidate still needs a valid NIN', () => {
    expect(getMissingProfileFields({ ...entries, candidateType: 'External' })).toEqual(['nationalId']);
  });
});

describe('profile details from an internal candidate', () => {
  test('ignore a National ID', async () => {
    prisma.candidate.update.mockResolvedValue({ id: 7 });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, candidateType: 'Internal', education: [], workExperience: [] });
    await candidateController.updateProfile({ user: internal, body: { nationalId: 'CM12345678ABCD', location: 'Entebbe' } }, mockRes());
    expect(prisma.candidate.update.mock.calls[0][0].data).not.toHaveProperty('nationalId');
  });
});
