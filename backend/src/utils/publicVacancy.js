// Vacancy columns that are for HR only and must never reach a candidate or
// anonymous visitor: the internal salary range and recruiter notes
// (documented as "HR only, never sent to the candidate-facing API" in
// CreateVacancyListing.jsx), plus the approval and audit trail - who
// created, approved or transitioned the vacancy, in what role, and
// internal workflow timestamps. No candidate screen reads any of them.
//
// Vacancy queries mostly use `include: { vacancy: true }` or no `select`,
// so Prisma returns every column; every response that hands a vacancy to
// a non-staff caller has to pass it through toPublicVacancy first.
const STAFF_ONLY_VACANCY_FIELDS = [
  'internalSalaryRange', 'recruiterNotes',
  'createdById', 'approvedById', 'approvedByRole', 'rejectionReason',
  'postingTypeChangedById', 'postingTypeChangedByRole', 'postingTypePreviousValue',
  'deadlineNotifiedAt', 'reviewStartedAt'
];

function toPublicVacancy(vacancy) {
  if (!vacancy) return vacancy;
  const copy = { ...vacancy };
  for (const field of STAFF_ONLY_VACANCY_FIELDS) delete copy[field];
  return copy;
}

module.exports = { STAFF_ONLY_VACANCY_FIELDS, toPublicVacancy };
