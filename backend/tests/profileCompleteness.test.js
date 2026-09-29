const { getMissingProfileFields } = require('../src/utils/profileCompleteness');

const complete = {
  candidateType: 'External', location: 'Entebbe', workAuthorization: 'Yes',
  idType: 'Passport', nationalId: 'A1234567',
  education: [{ id: 1 }], workExperience: [{ id: 1 }]
};

describe('district of origin (FR-ATS-034)', () => {
  test('is required from a National ID holder', () => {
    const candidate = { ...complete, idType: 'NationalID', nationalId: 'CM90012345678ABC' };
    expect(getMissingProfileFields(candidate)).toContain('districtOfOrigin');
    expect(getMissingProfileFields({ ...candidate, districtOfOrigin: 'Wakiso' })).not.toContain('districtOfOrigin');
  });

  test('is not asked of a passport holder, who may not be Ugandan', () => {
    expect(getMissingProfileFields(complete)).toEqual([]);
  });
});
