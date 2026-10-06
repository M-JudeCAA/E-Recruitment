// Where an application is in a vacancy's process (FR-ATS-042), worked out
// from its record - never stored, so it can't drift from it. Shown as the
// Stage column and filter chips of a vacancy's Applicants tab
// (ApplicantsTable.jsx): Applied -> System shortlist -> Shortlisting by
// committee -> Approval by EXCO -> Interviews -> Offer -> Onboarding, plus
// Not progressing. Moves between stages happen through each step's own
// audited action (FR-ATS-043): "Not progressing" is the reject, Onboarding
// is Mark as Hired on an accepted offer.

export const PIPELINE_COLUMNS = [
  { key: 'applied', label: 'Applied' },
  { key: 'system', label: 'System shortlist' },
  { key: 'committee', label: 'Shortlisting by committee' },
  { key: 'exco', label: 'Approval by EXCO' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'offer', label: 'Offer' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'closed', label: 'Not progressing' }
];

/** Which stage an application is at. committeeActive: the vacancy's committee has opened rating. */
export function pipelineColumn(app, committeeActive) {
  if (app.hire) return 'onboarding';
  if (['Rejected', 'Withdrawn'].includes(app.status)) return 'closed';
  if (app.status === 'Offered') return ['Declined', 'Expired', 'Withdrawn'].includes(app.offer?.status) ? 'closed' : 'offer';
  if (['InterviewScheduled', 'Interviewed'].includes(app.status)) return 'interviews';
  if (app.status === 'Shortlisted') return app.excoApprovalId || (app.interviewRounds || []).length ? 'interviews' : 'exco';
  if (app.status === 'ShortlistProposed') return 'committee';
  if (app.status === 'UnderReview') return committeeActive ? 'committee' : 'system';
  return 'applied';
}
