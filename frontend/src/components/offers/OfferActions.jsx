import React, { useState } from 'react';
import { CheckCircle2, Undo2, Pencil, XCircle, Printer } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Button from '../Button';
import Modal from '../Modal';
import TextArea from '../TextArea';
import OfferComposer from './OfferComposer';
import { errorMessage } from '../../utils/interviews';
import { OPEN_OFFER_STATUSES } from './offerFormat';
import { printFromApi } from '../../utils/printDocument';
import HireSection from './HireSection';

// Whatever the viewer's rank lets them do to an offer next, in one place for
// every screen that shows one (merit list, review card, Approvals Center,
// offer tracker):
//   Principal HR Officer+  revise terms (awaiting approval or returned), withdraw
//   Manager/Director       approve and issue, or return with a reason
// The backend enforces all of it (self-approval included); this only
// decides which buttons are worth showing.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
const small = { padding: '4px 10px', fontSize: 12 };

export default function OfferActions({ offer, applicationId, staffRole, onChanged }) {
  const rank = ROLE_RANK[staffRole] || 0;
  const [modal, setModal] = useState(null); // 'revise' | 'return' | 'withdraw'
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // undefined until HireSection has looked; null when not marked hired.
  const [hire, setHire] = useState(undefined);

  if (!offer) return null;
  const accepted = offer.status === 'Accepted';
  const canRevise = rank >= ROLE_RANK.Principal_HR_Officer && ['Recommended', 'Returned'].includes(offer.status);
  const canDecide = rank >= ROLE_RANK.Manager && offer.status === 'Recommended';
  // An accepted offer the candidate didn't take up: a Manager+ withdraws it,
  // until they are marked hired (the API also accepts a delegated Manager).
  const canWithdraw = (rank >= ROLE_RANK.Principal_HR_Officer && OPEN_OFFER_STATUSES.includes(offer.status))
    || (rank >= ROLE_RANK.Manager && accepted && hire === null);
  const reasonNeeded = accepted ? 10 : 0;
  const hasLetters = offer.salaryAmount != null && offer.status !== 'Withdrawn';
  if (!canRevise && !canDecide && !canWithdraw && !hasLetters && offer.status !== 'Accepted') return null;

  const act = async (key, fn, done) => {
    setBusy(key); setError(''); setNotice('');
    try {
      const res = await fn();
      setModal(null);
      if (done) setNotice(done(res));
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    } finally {
      setBusy('');
    }
  };
  const open = (which) => { setReason(''); setError(''); setModal(which); };

  // The letters, from the document templates (backend documentService).
  const print = async (kind) => {
    setError('');
    const problem = await printFromApi(staffClient, `/api/documents/offers/${offer.id}/${kind}`);
    if (problem) setError(problem);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {offer.salaryAmount != null && offer.status !== 'Withdrawn' && (
          <Button variant="ghost" style={small} onClick={() => print('offer-letter')} title="Print or save the offer letter as PDF">
            <Printer size={13} /> Offer letter
          </Button>
        )}
        {offer.status === 'Accepted' && (
          <Button variant="ghost" style={small} onClick={() => print('appointment')} title="Print or save the appointing instrument as PDF">
            <Printer size={13} /> Appointing instrument
          </Button>
        )}
        {canDecide && (
          <>
            <Button style={small} loading={busy === 'approve'} loadingText="Issuing..." disabled={!!busy}
              // The terms on screen are what is approved - changed since, the API refuses (OFFER_CHANGED).
              onClick={() => act('approve', () => staffClient.patch(`/api/applications/offers/${offer.id}/approve`, { expectedRecommendedDate: offer.recommendedDate }), () => 'Offer approved and issued to the candidate.')}>
              <CheckCircle2 size={13} /> Approve &amp; issue
            </Button>
            <Button variant="secondary" style={small} disabled={!!busy} onClick={() => open('return')}>
              <Undo2 size={13} /> Return
            </Button>
          </>
        )}
        {canRevise && (
          <Button variant={offer.status === 'Returned' ? 'primary' : 'secondary'} style={small} disabled={!!busy} onClick={() => setModal('revise')}>
            <Pencil size={13} /> {offer.status === 'Returned' ? 'Revise & resubmit' : 'Revise terms'}
          </Button>
        )}
        {canWithdraw && (
          <Button variant="ghost" style={{ ...small, color: 'var(--color-danger)' }} disabled={!!busy} onClick={() => open('withdraw')}>
            <XCircle size={13} /> Withdraw
          </Button>
        )}
      </div>
      <HireSection offer={offer} staffRole={staffRole} onChanged={onChanged} onHire={setHire} />
      {error && !modal && <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 4 }}>{error}</div>}
      {notice && <div style={{ color: 'var(--color-success)', fontSize: 12, marginTop: 4 }}>{notice}</div>}

      {modal === 'revise' && (
        <OfferComposer applicationId={applicationId} onClose={() => setModal(null)} onSaved={onChanged} />
      )}
      {modal === 'return' && (
        <Modal title="Return offer for revision" onClose={() => setModal(null)} footer={<>
          <Button variant="ghost" onClick={() => setModal(null)} disabled={!!busy}>Cancel</Button>
          <Button loading={busy === 'return'} loadingText="Returning..." disabled={reason.trim().length < 3}
            onClick={() => act('return', () => staffClient.patch(`/api/applications/offers/${offer.id}/return`, { reason }), () => 'Offer returned to the recommending officer.')}>
            Return offer
          </Button>
        </>}>
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            The recommending officer is told what to change and resubmits it. The candidate knows nothing about the offer until it is approved.
          </p>
          <TextArea label="What needs to change" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
      {modal === 'withdraw' && (
        <Modal title="Withdraw offer" onClose={() => setModal(null)} footer={<>
          <Button variant="ghost" onClick={() => setModal(null)} disabled={!!busy}>Cancel</Button>
          <Button loading={busy === 'withdraw'} loadingText="Withdrawing..." disabled={reason.trim().length < reasonNeeded}
            onClick={() => act('withdraw', () => staffClient.patch(`/api/applications/offers/${offer.id}/withdraw`, { reason: reason || undefined }),
              (res) => (res.data.promotedApplicationId
                ? `Offer withdrawn. The next reserve (application #${res.data.promotedApplicationId}) is now Primary.`
                : 'Offer withdrawn.'))}>
            Withdraw offer
          </Button>
        </>}>
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            {accepted
              ? 'The candidate accepted this offer. Withdraw it only if they will not be taking up the post; they will be told, with your reason. '
              : offer.status === 'Approved'
                ? 'The candidate has already been sent this offer and will be told it is withdrawn, with your reason. '
                : 'The candidate was never told about this offer. '}
            Unless the vacancy is already filled, the next reserve on the merit list moves up to Primary.
          </p>
          <TextArea label={accepted ? 'Reason' : 'Reason (optional)'} required={accepted} value={reason}
            hint={accepted ? 'At least 10 characters.' : undefined} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
