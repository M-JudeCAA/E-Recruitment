import React from 'react';
import { Clock } from 'lucide-react';
import StatusBadge from '../StatusBadge';
import { hintText } from '../interviews/formStyles';
import { OFFER_STATUS_LABELS, formatSalary, formatContract, formatDate, deadlineInfo } from './offerFormat';

// An offer as staff see it: its status, the terms, and the trail of who did
// what - recommended, returned, issued, and how it ended. `compact` keeps
// it to one or two lines for lists.

function DeadlineChip({ deadline }) {
  const info = deadlineInfo(deadline);
  if (!info) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600,
      color: info.urgent ? 'var(--color-danger)' : 'var(--color-text-muted)'
    }}>
      <Clock size={12} /> {info.passed ? 'Deadline passed' : `${info.label} (by ${formatDate(deadline)})`}
    </span>
  );
}

function Term({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...hintText, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function trail(offer) {
  const steps = [];
  if (offer.recommendedDate) steps.push(`Recommended ${formatDate(offer.recommendedDate)}${offer.recommendedBy?.name ? ` by ${offer.recommendedBy.name}` : ''}`);
  if (offer.returnedAt) steps.push(`returned ${formatDate(offer.returnedAt)}${offer.returnedBy?.name ? ` by ${offer.returnedBy.name}` : ''}: "${offer.returnReason}"`);
  if (offer.approvedDate) steps.push(`issued ${formatDate(offer.approvedDate)}${offer.approvedBy?.name ? ` by ${offer.approvedBy.name}` : ''}`);
  if (offer.decidedAt && ['Accepted', 'Declined', 'Expired', 'Withdrawn'].includes(offer.status)) {
    let end = `${offer.status.toLowerCase()} ${formatDate(offer.decidedAt)}`;
    if (offer.status === 'Declined' && offer.declineReason) end += `: "${offer.declineReason}"`;
    if (offer.status === 'Withdrawn') end += `${offer.withdrawnBy?.name ? ` by ${offer.withdrawnBy.name}` : ''}${offer.withdrawalReason ? `: "${offer.withdrawalReason}"` : ''}`;
    steps.push(end);
  }
  return steps.join(' · ');
}

export default function OfferSummary({ offer, compact = false }) {
  if (!offer) return null;
  const salary = formatSalary(offer);
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <StatusBadge status={offer.status} label={OFFER_STATUS_LABELS[offer.status] || offer.status} />
      {offer.status === 'Approved' && <DeadlineChip deadline={offer.responseDeadline} />}
      {compact && salary && <span style={{ fontSize: 13, fontWeight: 600 }}>{salary}</span>}
      {compact && offer.startDate && <span style={hintText}>from {formatDate(offer.startDate)}</span>}
    </div>
  );
  if (compact) {
    return (
      <div>
        {header}
        {offer.status === 'Returned' && offer.returnReason && (
          <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 3 }}>Returned: {offer.returnReason}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--color-bg)' }}>
      {header}
      {salary ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
            <Term label="Salary" value={salary} />
            <Term label="Employment" value={formatContract(offer)} />
            <Term label="Start date" value={formatDate(offer.startDate)} />
            <Term label="Duty station" value={offer.dutyStation} />
            <Term label="Time to respond" value={offer.responseDeadline ? `by ${formatDate(offer.responseDeadline)}` : `${offer.responseDays} days from approval`} />
          </div>
          {offer.allowances && <div style={{ fontSize: 13, marginTop: 8 }}><span style={hintText}>Allowances: </span>{offer.allowances}</div>}
          {Array.isArray(offer.conditions) && offer.conditions.length > 0 && (
            <div style={{ fontSize: 13, marginTop: 8 }}>
              <span style={hintText}>Conditional on: </span>{offer.conditions.join('; ')}
            </div>
          )}
        </>
      ) : (
        <div style={{ ...hintText, marginTop: 8 }}>No terms recorded - this offer was made before offer terms existed. Revise it to add them.</div>
      )}
      {(offer.meritRankAtOffer || offer.interviewScoreAtOffer != null) && (
        <div style={{ ...hintText, marginTop: 8 }}>
          At recommendation: {offer.meritRankAtOffer ? `merit list #${offer.meritRankAtOffer}` : ''}
          {offer.interviewScoreAtOffer != null ? `${offer.meritRankAtOffer ? ', ' : ''}interview score ${offer.interviewScoreAtOffer}` : ''}
        </div>
      )}
      {trail(offer) && <div style={{ ...hintText, marginTop: 6 }}>{trail(offer)}</div>}
    </div>
  );
}
