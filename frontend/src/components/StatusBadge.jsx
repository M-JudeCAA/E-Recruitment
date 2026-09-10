import React from 'react';

// Central color mapping for every status enum used across the system -
// change a status's color here and it updates everywhere it's shown.
const STATUS_COLORS = {
  // Panel/interview recommendation
  Shortlist: 'var(--color-accent)', Hold: 'var(--color-warning)', Reject: 'var(--color-danger)',
  // Vacancy
  PendingApproval: 'var(--color-warning)',
  Open: 'var(--color-accent)', PartiallyFilled: 'var(--color-warning)',
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

const STATUS_TINTS = {
  'var(--color-accent)': 'var(--color-accent-tint)',
  'var(--color-warning)': 'var(--color-warning-tint)',
  'var(--color-danger)': 'var(--color-danger-tint)',
  'var(--color-primary)': 'var(--color-primary-tint)',
  'var(--color-text-muted)': 'var(--color-muted-tint)'
};

export default function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || 'var(--color-text-muted)';
  const tint = STATUS_TINTS[color];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, color, background: tint
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {String(status).replace(/_/g, ' ')}
    </span>
  );
}
