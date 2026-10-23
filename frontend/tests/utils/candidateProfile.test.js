import { validateEmail, validateNationalId, validatePassword } from '../../src/utils/validators';
import { getMissingProfileFields, getProfileCompletionPercent, isProfileComplete } from '../../src/utils/profileCompleteness';
import { certificateKey, educationKey, workExperienceKey } from '../../src/utils/entryDedup';
import { SOURCES, rememberSourceFromUrl, rememberedSource } from '../../src/utils/applicationSources';

// Mirrors of backend/src/utils/validators.js and profileCompleteness.js.
describe('validators', () => {
  test('email', () => {
    expect(validateEmail(' jane@example.com ')).toBe(true);
    expect(validateEmail('jane@caa.co.ug')).toBe(true);
    expect(validateEmail('jane@example')).toBe(false);
    expect(validateEmail('jane example@x.com')).toBe(false);
    expect(validateEmail('')).toBe(false);
  });

  test('password: 8 or more characters with upper, lower, digit and symbol', () => {
    expect(validatePassword('ChangeMe123!')).toBe(true);
    expect(validatePassword('Short1!')).toBe(false);
    expect(validatePassword('nouppercase1!')).toBe(false);
    expect(validatePassword('NOLOWERCASE1!')).toBe(false);
    expect(validatePassword('NoDigitsHere!')).toBe(false);
    expect(validatePassword('NoSymbol1234')).toBe(false);
  });

  test('the NIN: C, F or M, two digits, ten letters or digits - in any case', () => {
    expect(validateNationalId('CM90ABCDEFGH12')).toBe(true);
    expect(validateNationalId(' cf85abcdefgh12 ')).toBe(true);
    expect(validateNationalId('CX90ABCDEFGH12')).toBe(false);
    expect(validateNationalId('CM90ABCDEFGH1')).toBe(false);
    expect(validateNationalId('AB1234567')).toBe(false); // a passport number
    expect(validateNationalId(undefined)).toBe(false);
  });
});

describe('profile completeness', () => {
  const complete = {
    location: 'Kampala', districtOfOrigin: 'Wakiso', nationalId: 'CM90ABCDEFGH12',
    education: [{ id: 1 }], workExperience: [{ id: 1 }], candidateType: 'External'
  };

  test('a complete External profile', () => {
    expect(getMissingProfileFields(complete)).toEqual([]);
    expect(isProfileComplete(complete)).toBe(true);
    expect(getProfileCompletionPercent(complete)).toBe(100);
  });

  test('names what is missing, and an invalid NIN counts as missing', () => {
    const candidate = { ...complete, districtOfOrigin: '', nationalId: 'B1234567', workExperience: [] };
    expect(getMissingProfileFields(candidate)).toEqual(['districtOfOrigin', 'nationalId', 'workExperience']);
    expect(isProfileComplete(candidate)).toBe(false);
    expect(getProfileCompletionPercent(candidate)).toBe(40);
  });

  test('nothing loaded yet is nothing complete', () => {
    expect(getMissingProfileFields(null)).toHaveLength(5);
    expect(getProfileCompletionPercent(null)).toBe(0);
  });

  test('an Internal candidate needs their employment details, not a NIN or a supervisor', () => {
    const internal = { ...complete, nationalId: null, candidateType: 'Internal', internalProfile: { employeeId: 'E1', department: 'HR', position: 'Officer' } };
    expect(getMissingProfileFields(internal)).toEqual(['internalProfile.dateJoined']);
    // 7 of 8 fields.
    expect(getProfileCompletionPercent(internal)).toBe(88);
    expect(getMissingProfileFields({ ...complete, candidateType: 'Internal' })).toHaveLength(4);
    expect(isProfileComplete({ ...internal, internalProfile: { ...internal.internalProfile, dateJoined: '2017-03-01' } })).toBe(true);
  });
});

describe('recognising an entry already on the profile', () => {
  test('ignores case and spacing', () => {
    expect(educationKey({ institution: ' Makerere  University', qualificationLevel: 'Bachelors', fieldOfStudy: 'LAW' }))
      .toBe(educationKey({ institution: 'makerere university', qualificationLevel: 'bachelors', fieldOfStudy: 'Law ' }));
  });

  test('work experience and certificates are told apart by their date', () => {
    const job = { employer: 'URA', jobTitle: 'HR Assistant' };
    expect(workExperienceKey({ ...job, startDate: '2016-01-01' })).toBe(workExperienceKey({ ...job, startDate: '2016-01-01T00:00:00.000Z' }));
    expect(workExperienceKey({ ...job, startDate: '2016-01-01' })).not.toBe(workExperienceKey({ ...job, startDate: '2018-01-01' }));
    expect(certificateKey({ name: 'CIPD', issuingOrganization: 'CIPD', issueDate: 'not a date' })).toBe('cipd|cipd|');
  });
});

describe('where the candidate saw the advert', () => {
  test('a ?source= the system knows is remembered for the visit', () => {
    rememberSourceFromUrl('?source=LinkedIn&utm=x');
    expect(rememberedSource()).toBe('LinkedIn');
  });

  test('an unknown source is ignored', () => {
    rememberSourceFromUrl('?source=<script>');
    expect(rememberedSource()).toBe('');
  });

  test('a later link without one keeps what was remembered', () => {
    rememberSourceFromUrl('?source=Newspaper');
    rememberSourceFromUrl('');
    expect(rememberedSource()).toBe('Newspaper');
  });

  test('every source has a key and a label', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    for (const s of SOURCES) expect(s).toEqual({ key: expect.stringMatching(/^[A-Za-z]+$/), label: expect.any(String) });
    expect(new Set(SOURCES.map((s) => s.key)).size).toBe(SOURCES.length);
  });
});
