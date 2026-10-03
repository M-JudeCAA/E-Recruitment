jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const { phoneKey } = require('../src/utils/phoneKey');
const duplicateApplicants = require('../src/services/duplicateApplicantService');
const candidateAuthController = require('../src/controllers/candidateAuthController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('phoneKey', () => {
  test.each([
    ['+256 772 123 456', '772123456'], ['256772123456', '772123456'], ['0772-123456', '772123456'], ['(0772) 123 456', '772123456']
  ])('%s -> %s', (raw, key) => expect(phoneKey(raw)).toBe(key));

  test('a number too short to identify anyone gives no key', () => {
    expect(phoneKey('12345')).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

describe('registration (FR-ATS-037)', () => {
  const signup = (extra = {}) => ({ body: {
    fullName: 'Grace Achieng', email: 'grace2@example.com', password: 'Str0ng!Pass', phone: '+256 772 123 456', ...extra
  } });

  test('a phone number another account uses gets the "is this you?" question, without naming the account', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    prisma.candidate.findFirst.mockResolvedValue({ id: 3 });
    const res = mockRes();

    await candidateAuthController.register(signup(), res);

    expect(prisma.candidate.findFirst).toHaveBeenCalledWith({ where: { phoneKey: '772123456' }, select: { id: true } });
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('POSSIBLE_DUPLICATE_ACCOUNT');
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  test('once they say it is not them, registration goes ahead', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    prisma.candidate.findFirst.mockResolvedValue({ id: 3 });
    prisma.pendingCandidateRegistration.findUnique.mockResolvedValue(null);
    prisma.pendingCandidateRegistration.create.mockResolvedValue({ id: 8 });
    const res = mockRes();
    await candidateAuthController.register(signup({ confirmNotDuplicate: true }), res);
    expect(prisma.pendingCandidateRegistration.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('duplicateApplicantService.annotate', () => {
  const app = (id, candidateId, phoneKeyValue, vacancyId = 1, fullName = `C${candidateId}`) => ({
    id, vacancyId, candidateId, candidate: { fullName, phoneKey: phoneKeyValue }
  });

  test('flags other applicants on the same vacancy, from another account, with the same phone', async () => {
    const a = app(10, 1, '772123456');
    const b = app(11, 2, '772123456', 1, 'Grace A.');
    const c = app(12, 3, '700000000');
    prisma.application.findMany.mockResolvedValue([a, b, c, app(13, 4, '772123456', 2)]);

    const [ra, rb, rc] = await duplicateApplicants.annotate([a, b, c]);

    expect(ra.possibleDuplicates).toEqual([{ applicationId: 11, candidateName: 'Grace A.', reason: 'Same phone number' }]);
    expect(rb.possibleDuplicates.map((d) => d.applicationId)).toEqual([10]);
    expect(rc.possibleDuplicates).toEqual([]);
  });

  test('does no lookup when nobody has a phone number', async () => {
    const result = await duplicateApplicants.annotate([app(10, 1, null)]);
    expect(result[0].possibleDuplicates).toEqual([]);
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });
});
