import { useState } from 'react';
import { Check, Send } from 'lucide-react';
import client from '../../models/apiClient';
import { useConfirm } from '../../components/ConfirmDialog';

// No fabricated reference number - applications don't have their own
// tracking reference distinct from the vacancy's real jobRef, so the
// confirmation shows that instead of inventing a field that doesn't
// exist in our schema.
function IneligibleNotice({ reasons, onCancelDraft, busy }) {
  return (
    <div style={{ background: '#fbeceb', color: 'var(--color-danger)', padding: 'var(--spacing-md)', borderRadius: 'var(--radius)', fontSize: 14, textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>
      <strong>You are not eligible for this role, so this application cannot be submitted.</strong>
      <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
        {reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <span style={{ fontSize: 13 }}>
        If your profile is missing something or out of date, or you answered an eligibility question by mistake, go back
        and fix it. Otherwise you can cancel this draft.
      </span>
      {onCancelDraft && (
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={onCancelDraft} disabled={busy}
            style={{ fontSize: 13, color: 'var(--color-danger)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
            Cancel this draft
          </button>
        </div>
      )}
    </div>
  );
}

// eligibility is ApplyForm's screening check (GET
// /api/applications/eligibility/:vacancyId, re-run on reaching this step) -
// an ineligible candidate gets the reasons instead of a Send button. The
// backend applies the same rules to the submit itself, so its 422 reasons
// are shown the same way if they ever disagree.
export default function SubmitStep({ vacancy, applicationId, status, eligibility, goToStep, onSubmitted, onWithdrawn }) {
  const confirm = useConfirm();
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);

  // applicationId should always be set by the time this step is reachable
  // (ApplyForm.jsx now auto-saves a draft when leaving Documents/Questions)
  // - this guard is only a last line of defense against a request firing
  // at /api/applications/undefined/submit if that save ever failed silently.
  const handleSubmit = async () => {
    if (!applicationId) { setError('Your application draft has not finished saving yet - please go back a step and try again.'); return; }
    setError(''); setRefusal(null); setBusy(true);
    try {
      await client.patch(`/api/applications/${applicationId}/submit`);
      onSubmitted();
    } catch (err) {
      if (err.response?.data?.code === 'NOT_ELIGIBLE') setRefusal(err.response.data.reasons || []);
      else setError(err.response?.data?.error || 'Submission failed');
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!applicationId) { setError('Your application draft has not finished saving yet - please go back a step and try again.'); return; }
    if (!(await confirm('Withdraw this application? This cannot be undone, and you will not be able to re-apply to this vacancy.', { title: 'Withdraw application', confirmLabel: 'Withdraw', danger: true }))) return;
    setBusy(true);
    try {
      await client.patch(`/api/applications/${applicationId}/withdraw`);
      onWithdrawn();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not withdraw');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'Submitted' || status === 'UnderReview') {
    return (
      <div className="text-center py-6">
        <span className="inline-flex items-center justify-center mb-4" style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-success)', color: '#fff' }}>
          <Check size={24} />
        </span>
        <div style={{ fontSize: 18, color: 'var(--color-text)', fontWeight: 600, marginBottom: 6 }}>Application sent</div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 380, margin: '0 auto 20px' }}>
          You've applied to <strong>{vacancy.title}</strong> ({vacancy.jobRef}). A confirmation has been sent to your email.
        </p>
        <button onClick={handleWithdraw} disabled={busy} style={{ fontSize: 13, color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>
          Withdraw this application
        </button>
        {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  const cancelDraft = async () => {
    if (!(await confirm('Cancel this draft application? Everything you entered for it will be deleted.', { title: 'Cancel draft', confirmLabel: 'Cancel draft', danger: true }))) return;
    setBusy(true);
    try {
      await client.patch(`/api/applications/${applicationId}/withdraw`);
      onWithdrawn();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cancel the draft');
    } finally {
      setBusy(false);
    }
  };

  const ineligibleReasons = refusal || (eligibility && !eligibility.eligible ? eligibility.reasons : null);
  if (ineligibleReasons) {
    return (
      <div className="py-6">
        <IneligibleNotice reasons={ineligibleReasons} onCancelDraft={applicationId ? cancelDraft : null} busy={busy} />
        {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 16, textAlign: 'center' }}>{error}</p>}
      </div>
    );
  }

  const missingAcademic = eligibility && eligibility.academicDocuments === 0;

  return (
    <div className="text-center py-6">
      {missingAcademic ? (
        <p style={{ fontSize: 14, color: 'var(--color-danger)', maxWidth: 420, margin: '0 auto 24px' }}>
          Please attach at least one academic document before sending.{' '}
          <button type="button" onClick={() => goToStep('documents')}
            style={{ fontSize: 14, color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
            Go to Documents
          </button>
        </p>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24, maxWidth: 420, margin: '0 auto 24px' }}>
          {eligibility?.eligible ? "You meet this role's requirements. " : ''}Once you send this, UCAA will confirm receipt by email.
        </p>
      )}
      <button onClick={handleSubmit} disabled={busy || missingAcademic}
        className="inline-flex items-center gap-2"
        style={{ background: 'var(--color-primary)', color: '#fff', padding: '12px 28px', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
        <Send size={15} /> {busy ? 'Sending...' : 'Send application'}
      </button>
      {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 16 }}>{error}</p>}
    </div>
  );
}
