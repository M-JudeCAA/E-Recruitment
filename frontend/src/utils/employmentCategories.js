// UCAA's employment categories, on a vacancy and on an offer. Only a fixed
// term contract has a length (contractMonths); a secondment has none.
// Mirrors backend/src/utils/employmentCategories.js.
export const EMPLOYMENT_CATEGORIES = ['FixedTermContract', 'Secondment', 'FullSecondment'];

export const EMPLOYMENT_LABELS = {
  FixedTermContract: 'Fixed term contract',
  Secondment: 'Secondment',
  FullSecondment: 'Full secondment'
};

export const employmentLabel = (category) => EMPLOYMENT_LABELS[category] || category || '';

export const hasContractLength = (category) => category === 'FixedTermContract';
