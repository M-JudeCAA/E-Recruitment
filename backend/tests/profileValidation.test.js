jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const rules = require('../src/utils/profileValidation');
const { refereeProblems, countCompleteReferees } = require('../src/utils/referees');
const candidateController = require('../src/controllers/candidateController');
const candidateAuthController = require('../src/controllers/candidateAuthController');

// Phone numbers, dates and links a candidate gives (utils/profileValidation.js,
// mirrored in the frontend). "Today" is 18 November 2026 in Kampala.

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const asCandidate = (body, params = {}) => ({ body, params, user: { id: 7, type: 'candidate', candidateType: 'External' } });

beforeAll(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-11-18T09:00:00Z')));
afterAll(() => jest.useRealTimers());
beforeEach(() => jest.clearAllMocks());

describe('phone numbers', () => {
  test.each(['0772 123456', '0772-123-456', '+256 772 123456', '256772123456', '(0772) 123456', '+44 20 7946 0958', '+1 202 555 0143'])(
    'accepts %s', (phone) => expect(rules.phoneError(phone)).toBeNull());
  test.each(['abc', '0772ABC456', '0772 12345', '07721234567', '+256 77212345', '12345678', '+0772123456', '++256772123456', '0772.123.456'])(
    'refuses %s', (phone) => expect(rules.phoneError(phone)).toBe(rules.PHONE_ERROR));
  test('an empty number is left to the "required" checks', () => expect(rules.phoneError('')).toBeNull());
});

describe('dates', () => {
  test('a certificate expires after it was issued, and is not issued in the future', () => {
    expect(rules.certificateDatesError({ issueDate: '2024-05-01', expiryDate: '2023-05-01' })).toMatch(/after the issue date/);
    expect(rules.certificateDatesError({ issueDate: '2024-05-01', expiryDate: '2024-05-01' })).toMatch(/after the issue date/);
    expect(rules.certificateDatesError({ issueDate: '2026-12-01', expiryDate: '' })).toMatch(/future/);
    expect(rules.certificateDatesError({ issueDate: '2024-05-01', expiryDate: '2030-05-01' })).toBeNull();
    expect(rules.certificateDatesError({ issueDate: '', expiryDate: '' })).toBeNull();
    expect(rules.certificateDatesError({ issueDate: '2024-02-30' })).toMatch(/not a valid date/);
  });

  test('work experience: no future dates, no end before start, start required', () => {
    expect(rules.workDatesError({ startDate: '2026-12-01' })).toMatch(/Start date can't be in the future/);
    expect(rules.workDatesError({ startDate: '2020-01-01', endDate: '2027-01-01' })).toMatch(/End date can't be in the future/);
    expect(rules.workDatesError({ startDate: '2020-01-01', endDate: '2019-01-01' })).toMatch(/before the start date/);
    expect(rules.workDatesError({ startDate: '' })).toMatch(/required/);
    expect(rules.workDatesError({ startDate: '2020-01-01', endDate: null })).toBeNull();
    expect(rules.workDatesError({ startDate: '2020-01-01T00:00:00.000Z', endDate: '2026-11-18' })).toBeNull();
  });

  test('education: a year from 1950 up to this year, or blank while studying', () => {
    expect(rules.yearCompletedError(2027)).toMatch(/future/);
    expect(rules.yearCompletedError(1900)).toMatch(/from 1950/);
    expect(rules.yearCompletedError('2026')).toBeNull();
    expect(rules.yearCompletedError('')).toBeNull();
  });

  test('date of birth: at least 18, not in the future, not over 100', () => {
    expect(rules.dateOfBirthError('2027-01-01')).toMatch(/future/);
    expect(rules.dateOfBirthError('2008-11-19')).toMatch(/at least 18/);
    expect(rules.dateOfBirthError('2008-11-18')).toBeNull();
    expect(rules.dateOfBirthError('1920-01-01')).toMatch(/over 100/);
    expect(rules.dateOfBirthError('')).toBeNull();
  });

  test('date joined UCAA: not in the future, not before birth', () => {
    expect(rules.dateJoinedError('2026-12-01')).toMatch(/future/);
    expect(rules.dateJoinedError('1980-01-01', '1990-01-01')).toMatch(/before your date of birth/);
    expect(rules.dateJoinedError('2015-03-01', '1990-01-01')).toBeNull();
  });
});

describe('links', () => {
  test('https:// is added when left out; only real web addresses', () => {
    expect(rules.normalizeUrl('linkedin.com/in/grace')).toEqual({ value: 'https://linkedin.com/in/grace' });
    expect(rules.normalizeUrl('http://grace.dev')).toEqual({ value: 'http://grace.dev' });
    expect(rules.normalizeUrl('')).toEqual({ value: '' });
    expect(rules.normalizeUrl('javascript:alert(1)').error).toBeTruthy();
    expect(rules.normalizeUrl('my portfolio').error).toBeTruthy();
    expect(rules.normalizeUrl('localhost').error).toBeTruthy();
  });
});

describe('referees', () => {
  const ok = [
    { name: 'A', phone: '0772123456', email: 'a@example.com' },
    { name: 'B', phone: '+256701555111', email: 'b@example.com' },
    { name: 'C', phone: '+44 20 7946 0958', email: 'c@example.com' }
  ];
  test('three with a valid phone and email pass', () => {
    expect(refereeProblems(ok, 'me@example.com')).toEqual([]);
    expect(countCompleteReferees(ok)).toBe(3);
  });
  test('letters in a phone, a bad email or the candidate\'s own email are each named', () => {
    const bad = [{ ...ok[0], phone: '07ab123456' }, { ...ok[1], email: 'not-an-email' }, { ...ok[2], email: 'Me@Example.com' }];
    expect(refereeProblems(bad, 'me@example.com')).toEqual([
      'Referee 1: the phone number is not valid.',
      'Referee 2: the email address is not valid.',
      "Referee 3: give the referee's email address, not your own."
    ]);
    expect(countCompleteReferees(bad)).toBe(1);
  });
});

describe('the API refuses them', () => {
  test('a certificate expiring before it was issued', async () => {
    const res = mockRes();
    await candidateController.addCertificate(asCandidate({ name: 'ACCA', issuingOrganization: 'ACCA', issueDate: '2024-05-01', expiryDate: '2023-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Expiry date must be after the issue date.', code: 'INVALID_DATES' });
  });

  test('work experience starting in the future', async () => {
    const res = mockRes();
    await candidateController.updateWorkExperience(asCandidate({ employer: 'UCAA', jobTitle: 'Officer', startDate: '2027-01-01' }, { id: '3' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('an education entry completed next year', async () => {
    const res = mockRes();
    await candidateController.addEducation(asCandidate({ institution: 'Makerere', qualificationLevel: 'Bachelors', fieldOfStudy: 'Law', yearCompleted: 2027 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a date of birth under 18, and a link that is not one; a bare link gets https://', async () => {
    let res = mockRes();
    await candidateController.updateProfile(asCandidate({ dateOfBirth: '2010-01-01' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    res = mockRes();
    await candidateController.updateProfile(asCandidate({ portfolioUrl: 'my site' }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    prisma.candidate.update.mockResolvedValue({ id: 7 });
    res = mockRes();
    await candidateController.updateProfile(asCandidate({ portfolioUrl: 'grace.dev' }), res);
    expect(prisma.candidate.update).toHaveBeenCalledWith(expect.objectContaining({ data: { portfolioUrl: 'https://grace.dev' } }));
  });

  test('a date joined UCAA in the future', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, dateOfBirth: new Date('1990-01-01') });
    const res = mockRes();
    await candidateController.updateInternalProfile({ ...asCandidate({ employeeId: 'E1', dateJoined: '2027-01-01' }), user: { id: 7, candidateType: 'Internal' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_DATES' }));
  });

  test('registration with letters in the phone number', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await candidateAuthController.register({ body: { fullName: 'Grace Achieng', email: 'grace@example.com', password: 'Str0ng!Pass', phone: '0772abc456' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PHONE' }));
  });
});
