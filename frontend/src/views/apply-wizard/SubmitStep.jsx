import { useState } from 'react';
import { Check, Send } from 'lucide-react';
import client from '../../models/apiClient';
import { useConfirm } from '../../components/ConfirmDialog';

// No fabricated reference number - applications don't have their own
// tracking reference distinct from the vacancy's real jobRef, so the
// confirmation shows that instead of inventing a field that doesn't
// exist in our schema.
export default function SubmitStep({ vacancy, applicationId, status, onSubmitted, onWithdrawn }) {
  const confirm = useConfirm();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // applicationId should always be set by the time this step is reachable
  // (ApplyForm.jsx now auto-saves a draft when leaving Documents/Questions)
  // - this guard is only a last line of defense against a request firing
  // at /api/applications/undefined/submit if that save ever failed silently.
  const handleSubmit = async () => {
    if (!applicationId) { setError('Your application draft has not finished saving yet - please go back a step and try again.'); return; }
    setError(''); setBusy(true);
    try {
      await client.patch(`/api/applications/${applicationId}/submit`);
      onSubmitted();
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed');
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

  return (
    <div className="text-center py-6">
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24, maxWidth: 420, margin: '0 auto 24px' }}>
        Everything's in order. Once you send this, UCAA will confirm receipt by email.
      </p>
      <button onClick={handleSubmit} disabled={busy}
        className="inline-flex items-center gap-2"
        style={{ background: 'var(--color-primary)', color: '#fff', padding: '12px 28px', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
        <Send size={15} /> {busy ? 'Sending...' : 'Send application'}
      </button>
      {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 16 }}>{error}</p>}
    </div>
  );
}
