// The order a candidate's records are shown in, everywhere (UAT-034): newest
// first - the latest job by start date, the latest qualification (one still
// in progress before any completed), the latest certificate. The order they
// were entered in means nothing: screening counts experience from the dates.
//
// Used as the relation's include: `{ workExperience: RECORD_ORDER.workExperience }`.
const RECORD_ORDER = {
  workExperience: { orderBy: [{ startDate: 'desc' }, { id: 'desc' }] },
  education: { orderBy: [{ yearCompleted: { sort: 'desc', nulls: 'first' } }, { id: 'desc' }] },
  certificates: { orderBy: [{ issueDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }] }
};

module.exports = { RECORD_ORDER };
