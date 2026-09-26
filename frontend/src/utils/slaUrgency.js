// Shared urgency classification for a /api/dashboard/follow-ups item -
// used by FollowUpsPanel.jsx (HRHome/ExecutiveDashboard) and
// ApprovalsCenter.jsx's per-row badges, so "what counts as overdue vs due
// soon" is defined exactly once.
function formatHours(hours) {
  const abs = Math.abs(hours);
  if (abs < 24) return `${Math.max(Math.round(abs), 0)}h`;
  return `${Math.round(abs / 24)}d`;
}

const DUE_SOON_THRESHOLD_HOURS = 6;

export function urgencyOf(item) {
  if (!item) return null;
  if (item.isOverdue) {
    return { tier: 'overdue', color: 'var(--color-danger)', label: `Overdue by ${formatHours(item.hoursRemaining)}` };
  }
  if (item.hoursRemaining <= DUE_SOON_THRESHOLD_HOURS) {
    return { tier: 'due-soon', color: 'var(--color-warning)', label: `Due in ${formatHours(item.hoursRemaining)}` };
  }
  return { tier: 'on-track', color: 'var(--color-accent)', label: `Due in ${formatHours(item.hoursRemaining)}` };
}

// Recomputes hoursRemaining/isOverdue from the absolute dueAt timestamp
// against a live `now` - the server-supplied hoursRemaining goes stale the
// instant it's fetched, so the ticking countdown in FollowUpsPanel needs
// this rather than trusting the original numbers forever.
export function withLiveCountdown(item, now) {
  const hoursRemaining = (new Date(item.dueAt).getTime() - now) / (1000 * 60 * 60);
  return { ...item, hoursRemaining, isOverdue: hoursRemaining <= 0 };
}
