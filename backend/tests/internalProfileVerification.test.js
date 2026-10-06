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
const details = {
  employeeId: 'UCAA/2017/0412', department: 'IT', position: 'Systems Officer',
  dateJoined: '2017-03-01', supervisorName: 'Ben Tumwine', supervisorEmail: 'ben.tumwine@caa.co.ug'
};
const onFile = (over = {}) => ({ ...details, dateJoined: new Date('2017-03-01T00:00:00Z'), verificationStatus: 'HR_Verified', verifiedById: 3, verifiedDate: new Date(), ...over });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.internalProfile.update.mockImplementation(({ data }) => Promise.resolve({ ...data }));
});

describe('updateInternalProfile and HR verification', () => {
  test('saving the same details keeps the verification', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue(onFile());
    await candidateController.updateInternalProfile(req(details), mockRes());
    expect(prisma.internalProfile.update.mock.calls[0][0].data.verificationStatus).toBeUndefined();
  });

  test('changing a detail after verification sends it back to Pending', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue(onFile());
    await candidateController.updateInternalProfile(req({ ...details, position: 'Senior Systems Officer' }), mockRes());
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
