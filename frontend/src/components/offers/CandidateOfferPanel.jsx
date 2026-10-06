import React, { useState } from 'react';
import { Award, Clock, CheckCircle2, Download } from 'lucide-react';
import client from '../../models/apiClient';
import { printFromApi } from '../../utils/printDocument';
import Button from '../Button';
import Modal from '../Modal';
import TextArea from '../TextArea';
import StatusBadge from '../StatusBadge';
import { formatSalary, formatContract, formatDate, deadlineInfo, candidateOfferStatus } from './offerFormat';

// The candidate's own offer, once issued (the backend hides it before that -
// offerService.toCandidateOffer). Reads like the offer itself: the terms,
// the conditions, and how long they have to answer; accepting asks them to
// confirm, declining lets them say why.

const CANDIDATE_LABELS = { Approved: 'Awaiting your answer', Accepted: 'Accepted', Declined: 'Declined', Expired: 'Lapsed', Withdrawn: 'Withdrawn' };

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 14, padding: '4px 0' }}>
      <span style={{ width: 130, flexShrink: 0, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, minWidth: 0 }}>{value}</span>
    </div>
  );
}

export default function CandidateOfferPanel({ offer, jobTitle, busy, onRespond }) {
  const [modal, setModal] = useState(null); // 'accept' | 'decline'
  const [reason, setReason] = useState('');
  const deadline = deadlineInfo(offer.responseDeadline);
  const status = candidateOfferStatus(offer);
  const open = status === 'Approved';
  const [letterError, setLetterError] = useState('');
  const letter = async () => {
    setLetterError('');
    const problem = await printFromApi(client, `/api/candidates/me/offers/${offer.id}/letter`);
    if (problem) setLetterError(problem);
  };
  const respond = async (action) => {
    await onRespond(action, action === 'decline' ? reason : undefined);
    setModal(null);
  };

  return (
    <div style={{
      marginTop: 10, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
      border: `1px solid ${open ? 'var(--color-accent)' : 'var(--color-border)'}`
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px',
        background: open ? 'var(--color-accent)' : 'var(--color-bg-subtle)', color: open ? '#fff' : 'var(--color-text)'
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <Award size={18} /> {offer.status === 'Accepted' ? 'Your new role' : 'Offer of employment'}
        </span>
        {open && deadline ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600 }}>
            <Clock size={14} /> Answer by {formatDate(offer.responseDeadline)} · {deadline.label}
          </span>
        ) : <StatusBadge status={status} label={CANDIDATE_LABELS[status] || status} />}
      </div>

      <div style={{ padding: '10px 12px', background: 'var(--color-bg)' }}>
        <Row label="Position" value={jobTitle} />
        <Row label="Salary" value={formatSalary(offer)} />
        <Row label="Employment" value={formatContract(offer)} />
        <Row label="Start date" value={offer.startDate ? formatDate(offer.startDate) : null} />
        <Row label="Duty station" value={offer.dutyStation} />
        <Row label="Allowances" value={offer.allowances} />
        {offer.conditions?.length > 0 && (
          <div style={{ fontSize: 14, padding: '4px 0' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>This offer is conditional on:</span>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {offer.conditions.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        )}

        {offer.status === 'Accepted' && (
          <p style={{ margin: '8px 0 0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}>
            <CheckCircle2 size={16} /> You accepted this offer on {formatDate(offer.decidedAt)}. HR will be in touch about the conditions above and your first day.
          </p>
        )}
        {offer.status === 'Declined' && (
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>You declined this offer on {formatDate(offer.decidedAt)}.</p>
        )}
        {status === 'Expired' && (
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
            The deadline to respond passed on {formatDate(offer.responseDeadline)}, so this offer has lapsed. Please contact HR if you believe this is a mistake.
          </p>
        )}
        {offer.status === 'Withdrawn' && (
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
            This offer was withdrawn{offer.decidedAt ? ` on ${formatDate(offer.decidedAt)}` : ''}.{offer.withdrawalReason ? ` Reason: ${offer.withdrawalReason}` : ''}
          </p>
        )}

        {offer.status !== 'Withdrawn' && (
          <div style={{ marginTop: 8 }}>
            <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={letter}><Download size={14} /> Offer letter (print or save as PDF)</Button>
            {letterError && <div style={{ color: 'var(--color-danger)', fontSize: 12 }}>{letterError}</div>}
          </div>
        )}
        {open && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button loading={busy === 'accept'} onClick={() => setModal('accept')}>Accept offer</Button>
            <Button variant="ghost" loading={busy === 'decline'} onClick={() => { setReason(''); setModal('decline'); }}>Decline</Button>
          </div>
        )}
      </div>

      {modal === 'accept' && (
        <Modal title="Accept this offer?" onClose={() => setModal(null)} footer={<>
          <Button variant="ghost" onClick={() => setModal(null)} disabled={!!busy}>Not yet</Button>
          <Button loading={busy === 'accept'} loadingText="Accepting..." onClick={() => respond('accept')}>Yes, I accept</Button>
        </>}>
          <p style={{ marginTop: 0, fontSize: 14 }}>
            You are accepting the position of <strong>{jobTitle}</strong>
            {formatSalary(offer) ? <> at <strong>{formatSalary(offer)}</strong></> : ''}
            {offer.startDate ? <>, starting <strong>{formatDate(offer.startDate)}</strong></> : ''}.
          </p>
          {offer.conditions?.length > 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              The appointment remains conditional on: {offer.conditions.join('; ')}.
            </p>
          )}
        </Modal>
      )}
      {modal === 'decline' && (
        <Modal title="Decline this offer" onClose={() => setModal(null)} footer={<>
          <Button variant="ghost" onClick={() => setModal(null)} disabled={!!busy}>Cancel</Button>
          <Button loading={busy === 'decline'} loadingText="Declining..." onClick={() => respond('decline')}>Decline offer</Button>
        </>}>
          <p style={{ marginTop: 0, fontSize: 14 }}>Declining is final - the position will be offered to another candidate.</p>
          <TextArea label="Would you like to tell us why? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
