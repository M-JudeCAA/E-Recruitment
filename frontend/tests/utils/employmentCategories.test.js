import { EMPLOYMENT_CATEGORIES, EMPLOYMENT_LABELS, employmentLabel, hasContractLength } from '../../src/utils/employmentCategories';

// Mirrors backend/src/utils/employmentCategories.js.
describe('employment categories', () => {
  test('are the three UCAA uses, in order, each with its wording', () => {
    expect(EMPLOYMENT_CATEGORIES).toEqual(['FixedTermContract', 'Secondment', 'FullSecondment']);
    expect(EMPLOYMENT_CATEGORIES.map(employmentLabel)).toEqual(['Fixed term contract', 'Secondment', 'Full secondment']);
    expect(Object.keys(EMPLOYMENT_LABELS)).toEqual(EMPLOYMENT_CATEGORIES);
  });

  test('only a fixed term contract has a length', () => {
    expect(hasContractLength('FixedTermContract')).toBe(true);
    expect(hasContractLength('Secondment')).toBe(false);
    expect(hasContractLength('FullSecondment')).toBe(false);
  });

  test('a value it does not know is shown as it is', () => {
    expect(employmentLabel('FullTime')).toBe('FullTime');
    expect(employmentLabel(null)).toBe('');
  });
});
