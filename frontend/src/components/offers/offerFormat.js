// Shared wording for offers - staff screens and the candidate's own view.

export const EMPLOYMENT_LABELS = {
  FullTime: 'Permanent, full time',
  Contract: 'Contract',
  FixedTermContract: 'Fixed-term contract'
};

// Offer statuses still waiting on someone (HR, an approver or the candidate).
export const OPEN_OFFER_STATUSES = ['Recommended', 'Returned', 'Approved'];

// Mirrors backend offerService limits.
export const MIN_RESPONSE_DAYS = 3;
export const MAX_RESPONSE_DAYS = 30;

// Staff-facing name for each status (the candidate never sees the first two).
export const OFFER_STATUS_LABELS = {
  Recommended: 'Awaiting approval',
  Returned: 'Returned for revision',
  Approved: 'Issued - awaiting candidate',
  Accepted: 'Accepted',
  Declined: 'Declined',
  Expired: 'Expired',
  Withdrawn: 'Withdrawn'
};

// salaryAmount arrives as a string (a Prisma Decimal) - "UGX 4,500,000 / month".
export function formatSalary(offer) {
  if (!offer || offer.salaryAmount == null) return null;
  const amount = Number(offer.salaryAmount).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${offer.salaryCurrency || 'UGX'} ${amount} / ${offer.salaryPeriod === 'Annual' ? 'year' : 'month'}`;
}

export function formatContract(offer) {
  if (!offer?.employmentCategory) return null;
  const label = EMPLOYMENT_LABELS[offer.employmentCategory] || offer.employmentCategory;
  return offer.contractMonths ? `${label}, ${offer.contractMonths} months` : label;
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

// "3 days left", "5 hours left", "expired" - and how urgent that is.
export function deadlineInfo(deadline, now = new Date()) {
  if (!deadline) return null;
  const ms = new Date(deadline) - now;
  if (ms <= 0) return { label: 'Deadline passed', urgent: true, passed: true };
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  const label = days >= 1 ? `${days} day${days === 1 ? '' : 's'} left` : `${Math.max(hours, 1)} hour${hours === 1 ? '' : 's'} left`;
  return { label, urgent: days < 3, passed: false };
}
