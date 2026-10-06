import React from 'react';

// Central color mapping for every status enum used across the system -
// change a status's color here and it updates everywhere it's shown.
// Exported so other status-driven visuals (e.g. HRHome's status breakdown
// bar) reuse the exact same mapping instead of duplicating it.
export const STATUS_COLORS = {
  // Panel/interview recommendation
  Shortlist: 'var(--color-accent)', Hold: 'var(--color-warning)', Reject: 'var(--color-danger)',
  // How sure the requisition reader is of a value it read (RequisitionPanel)
  HighConfidence: 'var(--color-accent)', MediumConfidence: 'var(--color-warning)',
  LowConfidence: 'var(--color-danger)', NotFound: 'var(--color-text-muted)',
  // Merit list place (Application.meritListStatus)
  Primary: 'var(--color-accent)', Reserve: 'var(--color-primary)',
  // Vacancy
  PendingApproval: 'var(--color-warning)',
  Open: 'var(--color-accent)', PartiallyFilled: 'var(--color-warning)',
  Filled: 'var(--color-primary)', Closed: 'var(--color-text-muted)',
  // Application
  Draft: 'var(--color-text-muted)', Submitted: 'var(--color-primary)',
  UnderReview: 'var(--color-warning)', ShortlistProposed: 'var(--color-warning)', Shortlisted: 'var(--color-accent)',
  Interviewed: 'var(--color-accent)', Offered: 'var(--color-accent)',
  InterviewScheduled: 'var(--color-warning)',
  Rejected: 'var(--color-danger)', Withdrawn: 'var(--color-text-muted)',
  // Offer
  Recommended: 'var(--color-warning)', Approved: 'var(--color-accent)',
  Extended: 'var(--color-accent)', Accepted: 'var(--color-accent)',
  Declined: 'var(--color-danger)', Returned: 'var(--color-warning)', Expired: 'var(--color-text-muted)',
  // Interview round status (InterviewRoundStatus) and the candidate's answer
  // (InterviewCandidateResponse). "Held" is the candidate-facing name for
  // Completed (see backend utils/candidateInterview.js).
  Scheduled: 'var(--color-primary)', Completed: 'var(--color-accent)', Held: 'var(--color-accent)',
  Cancelled: 'var(--color-text-muted)', NoShow: 'var(--color-danger)',
  Confirmed: 'var(--color-accent)', RescheduleRequested: 'var(--color-warning)',
  // Staff account state (StaffAccounts.jsx)
  Active: 'var(--color-accent)', Deactivated: 'var(--color-text-muted)',
  // Verification
  Pending: 'var(--color-warning)', HR_Verified: 'var(--color-accent)',
  Discrepancy_Flagged: 'var(--color-danger)',
  // Shortlisting committee band (ShortlistBand) and exercise stage
  // (ShortlistExerciseStatus)
  Unanimous: 'var(--color-accent)', Majority: 'var(--color-primary)',
  Disputed: 'var(--color-warning)', NotQualified: 'var(--color-danger)',
  Setup: 'var(--color-text-muted)', Rating: 'var(--color-warning)', Moderation: 'var(--color-warning)',
  // Not a real enum value - a derived tag shown next to a vacancy's title
  // when it was created via readvertise() (Vacancy.readvertisedFromId is
  // set). Reuses this same lookup/component rather than a bespoke badge.
  Readvertised: 'var(--color-accent)'
};

// Words people read for a status enum - "PendingApproval" shows as
// "Pending approval", "HR_Verified" as "HR verified". Exported for charts
// and legends that name statuses outside a badge.
const STATUS_LABELS = {
  NoShow: 'No-show', HR_Verified: 'HR verified', NotQualified: 'Not qualified',
  ShortlistProposed: 'Shortlist proposed', RescheduleRequested: 'New time requested'
};
export function statusLabel(status) {
  if (status == null) return '';
  const key = String(status);
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  return words.map((w, i) => (i === 0 || /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

// label optionally overrides the displayed text (e.g. "No-show" for
// NoShow) without changing how the status is colored. The look lives in
// theme.css (.status-badge): a solid pill on the candidate site, a soft
// tint on the staff workspace.
export default function StatusBadge({ status, label }) {
  const color = STATUS_COLORS[status] || 'var(--color-text-muted)';
  return (
    <span className="status-badge" style={{ '--badge-color': color }}>
      {label || statusLabel(status)}
    </span>
  );
}
