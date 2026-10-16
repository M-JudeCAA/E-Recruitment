jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const candidateController = require('../src/controllers/candidateController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const req = (body) => ({ user: { id: 7, type: 'candidate', candidateType: 'Internal' }, body });
// Picked from the organisation structure: IT (4), and its positions.
const it = { id: 4, name: 'Information Technology', status: 'Approved', directorateId: 1, directorate: { status: 'Approved' } };
const POSITIONS = {
  40: { id: 40, name: 'Systems Officer', departmentId: 4, status: 'Approved', department: it },
  41: { id: 41, name: 'Senior Systems Officer', departmentId: 4, status: 'Approved', department: it },
  50: { id: 50, name: 'Accountant', departmentId: 5, status: 'Approved', department: { ...it, id: 5, name: 'Finance' } },
  60: { id: 60, name: 'Old Post', departmentId: 4, status: 'Rejected', department: it }
};
const details = {
  employeeId: 'UCAA/2017/0412', departmentId: 4, positionId: 40,
  dateJoined: '2017-03-01', supervisorName: 'Ben Tumwine', supervisorEmail: 'ben.tumwine@caa.co.ug'
};
const onFile = (over = {}) => ({ ...details, department: 'Information Technology', position: 'Systems Officer', dateJoined: new Date('2017-03-01T00:00:00Z'), verificationStatus: 'HR_Verified', verifiedById: 3, verifiedDate: new Date(), ...over });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.internalProfile.update.mockImplementation(({ data }) => Promise.resolve({ ...data }));
  prisma.position.findUnique.mockImplementation(({ where }) => Promise.resolve(POSITIONS[where.id] || null));
});

describe('updateInternalProfile and HR verification', () => {
  test('saving the same details keeps the verification', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue(onFile());
    await candidateController.updateInternalProfile(req(details), mockRes());
    expect(prisma.internalProfile.update.mock.calls[0][0].data.verificationStatus).toBeUndefined();
  });

  test('changing a detail after verification sends it back to Pending', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue(onFile());
    await candidateController.updateInternalProfile(req({ ...details, positionId: 41 }), mockRes());
    expect(prisma.internalProfile.update.mock.calls[0][0].data).toMatchObject({ verificationStatus: 'Pending', verifiedById: null, verifiedDate: null });
  });

  test('a flagged discrepancy that is corrected goes back to Pending too', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue(onFile({ verificationStatus: 'Discrepancy_Flagged' }));
    await candidateController.updateInternalProfile(req({ ...details, employeeId: 'UCAA/2017/0413' }), mockRes());
    expect(prisma.internalProfile.update.mock.calls[0][0].data.verificationStatus).toBe('Pending');
  });

  test('an external candidate has no internal profile', async () => {
    const res = mockRes();
    await candidateController.updateInternalProfile({ user: { id: 7, candidateType: 'External' }, body: details }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('department and position are picked from the organisation structure', () => {
  test('stores the ids and the names from those rows, whatever names were sent', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue(null);
    await candidateController.updateInternalProfile(req({ ...details, department: 'typed dept', position: 'typed post' }), mockRes());
    expect(prisma.internalProfile.update.mock.calls[0][0].data).toMatchObject({
      departmentId: 4, positionId: 40, department: 'Information Technology', position: 'Systems Officer'
    });
  });

  test.each([
    [{ departmentId: undefined }, 'DEPARTMENT_NOT_PICKED'],
    [{ positionId: '' }, 'POSITION_NOT_PICKED'],
    [{ positionId: 50 }, 'POSITION_NOT_IN_DEPARTMENT'],
    [{ positionId: 60 }, 'POSITION_NOT_IN_DEPARTMENT'],
    [{ positionId: 999 }, 'POSITION_NOT_IN_DEPARTMENT']
  ])('refuses %j (%s)', async (over, code) => {
    await expect(candidateController.updateInternalProfile(req({ ...details, ...over }), mockRes()))
      .rejects.toMatchObject({ status: 400, code });
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test('the choices are the approved departments and their approved positions, for internal candidates only', async () => {
    prisma.department.findMany.mockResolvedValue([{ id: 4, code: 'IT', name: 'Information Technology', directorate: { code: 'CORP', name: 'Corporate' } }]);
    prisma.position.findMany.mockResolvedValue([{ id: 40, code: 'SO', name: 'Systems Officer', departmentId: 4 }]);
    const res = mockRes();
    await candidateController.organisationChoices(req({}), res);
    expect(res.json).toHaveBeenCalledWith({
      departments: [expect.objectContaining({ id: 4 })], positions: [expect.objectContaining({ id: 40, departmentId: 4 })]
    });
    expect(prisma.department.findMany.mock.calls[0][0].where).toEqual({
      status: 'Approved', OR: [{ directorateId: null }, { directorate: { status: 'Approved' } }]
    });
    expect(prisma.position.findMany.mock.calls[0][0].where).toEqual({ status: 'Approved', departmentId: { in: [4] } });

    const external = mockRes();
    await candidateController.organisationChoices({ user: { id: 7, candidateType: 'External' } }, external);
    expect(external.status).toHaveBeenCalledWith(403);
  });
});
