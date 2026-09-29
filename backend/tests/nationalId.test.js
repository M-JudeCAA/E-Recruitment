jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const candidateAuthController = require('../src/controllers/candidateAuthController');
const candidateController = require('../src/controllers/candidateController');
const { normalizeNationalId } = require('../src/utils/validators');

// The Uganda NIN is the only identity document a candidate gives - no
// passports, no ID-type choice.

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

const signup = (nationalId) => ({
  body: { fullName: 'Grace Achieng', email: 'grace@example.com', password: 'Str0ng!Pass', nationalId }
});

test('normalizeNationalId trims and upper-cases', () => {
  expect(normalizeNationalId('  cm90012345abcd ')).toBe('CM90012345ABCD');
  expect(normalizeNationalId(undefined)).toBe('');
});

describe('registration', () => {
  test('refuses anything that is not a NIN, such as a passport number', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await candidateAuthController.register(signup('A1234567'), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('National Identification Number') });
  });

  test('checks a NIN for duplicates in its stored (upper-case) form', async () => {
    prisma.candidate.findUnique.mockImplementation(async ({ where }) => (where.nationalId ? { id: 9 } : null));
    const res = mockRes();
    await candidateAuthController.register(signup(' cm90012345abcd'), res);
    expect(prisma.candidate.findUnique).toHaveBeenCalledWith({ where: { nationalId: 'CM90012345ABCD' } });
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('profile update', () => {
  const req = (body) => ({ body, user: { id: 5, type: 'candidate' } });

  test('refuses a passport number', async () => {
    const res = mockRes();
    await candidateController.updateProfile(req({ nationalId: 'A1234567' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.candidate.update).not.toHaveBeenCalled();
  });

  test('stores a valid NIN upper-cased and ignores any ID type sent by an old client', async () => {
    prisma.candidate.update.mockResolvedValue({ id: 5 });
    prisma.candidate.findUnique.mockResolvedValue({ id: 5, profileCompletedAt: new Date() });
    await candidateController.updateProfile(req({ nationalId: 'cm90012345abcd', idType: 'Passport' }), mockRes());
    expect(prisma.candidate.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { nationalId: 'CM90012345ABCD' } });
  });
});
