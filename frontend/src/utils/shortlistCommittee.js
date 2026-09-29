// Shared wording for the shortlisting committee (backend
// shortlistCommitteeService.js has the rules).

export const BAND_LABELS = {
  Unanimous: 'Qualified - unanimous',
  Majority: 'Qualified - majority',
  Disputed: 'Disputed',
  NotQualified: 'Not qualified'
};

export const STAGE_LABELS = {
  Setup: 'Setting up',
  Rating: 'Rating open',
  Moderation: 'Moderation',
  Closed: 'Closed'
};

// Essential criteria: 0 not met, 1 partly met, 2 met. Desirable: 1-5.
export const ESSENTIAL_OPTIONS = [
  { value: 2, label: 'Met' },
  { value: 1, label: 'Partly met' },
  { value: 0, label: 'Not met' }
];
export const ESSENTIAL_LABELS = { 2: 'Met', 1: 'Partly met', 0: 'Not met' };
export const DESIRABLE_LABELS = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Strong', 5: 'Outstanding' };

export function ratingLabel(criterion, value) {
  if (value == null) return '—';
  return criterion.kind === 'Essential' ? ESSENTIAL_LABELS[value] : `${value} - ${DESIRABLE_LABELS[value]}`;
}
