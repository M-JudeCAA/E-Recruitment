const { getMissingProfileFields } = require('../src/utils/profileCompleteness');

const complete = {
  candidateType: 'External', location: 'Entebbe', workAuthorization: 'Yes', districtOfOrigin: 'Wakiso',
  nationalId: 'CM90012345ABCD', education: [{ id: 1 }], workExperience: [{ id: 1 }]
};

test('a profile with a valid NIN, district and the rest is complete', () => {
  expect(getMissingProfileFields(complete)).toEqual([]);
});

test('district of origin is required (FR-ATS-034)', () => {
  expect(getMissingProfileFields({ ...complete, districtOfOrigin: null })).toEqual(['districtOfOrigin']);
});

test.each([
  ['missing', null],
  ['a passport number, from before passports were dropped', 'A1234567'],
  ['too long', 'CM90012345678ABC']
])('the NIN is the only identity document - %s counts as missing', (_, nationalId) => {
  expect(getMissingProfileFields({ ...complete, nationalId })).toEqual(['nationalId']);
});
