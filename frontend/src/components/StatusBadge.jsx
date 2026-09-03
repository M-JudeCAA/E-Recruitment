import React from 'react';

// Central color mapping for every status enum used across the system -
// change a status's color here and it updates everywhere it's shown.
const STATUS_COLORS = {
  // Panel/interview recommendation
  Shortlist: 'var(--color-accent)', Hold: 'var(--color-warning)', Reject: 'var(--color-danger)',
  // Vacancy
  PendingApproval: 'var(--color-warning)', Open: 'var(--color-accent)', PartiallyFilled: 'var(--color-warning)',
  Filled: 'var(--color-primary)', Closed: 'var(--color-text-muted)',
  // Application
  Draft: 'var(--color-text-muted)', Submitted: 'var(--color-primary)',
  UnderReview: 'var(--color-warning)', Shortlisted: 'var(--color-accent)',
  Interviewed: 'var(--color-accent)', Offered: 'var(--color-accent)',
  InterviewScheduled: 'var(--color-warning)',
  Rejected: 'var(--color-danger)', Withdrawn: 'var(--color-text-muted)',
  // Offer
  Recommended: 'var(--color-warning)', Approved: 'var(--color-accent)',
  Extended: 'var(--color-accent)', Accepted: 'var(--color-accent)',
  Declined: 'var(--color-danger)',
  // Verification
  Pending: 'var(--color-warning)', HR_Verified: 'var(--color-accent)',
  Discrepancy_Flagged: 'var(--color-danger)'
};

export default function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || 'var(--color-text-muted)';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, color: '#fff', background: color
    }}>
      {String(status).replace(/_/g, ' ')}
    </span>
  );
}
