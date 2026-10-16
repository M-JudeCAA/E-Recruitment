// UCAA's employment categories (the EmploymentCategory enum), on a vacancy
// and on an offer. Only a fixed term contract has a length
// (Offer.contractMonths); a secondment has none.
// Mirrored in frontend/src/utils/employmentCategories.js.
const EMPLOYMENT_CATEGORIES = ['FixedTermContract', 'Secondment', 'FullSecondment'];

const EMPLOYMENT_LABELS = {
  FixedTermContract: 'Fixed term contract',
  Secondment: 'Secondment',
  FullSecondment: 'Full secondment'
};

const hasContractLength = (category) => category === 'FixedTermContract';

module.exports = { EMPLOYMENT_CATEGORIES, EMPLOYMENT_LABELS, hasContractLength };
