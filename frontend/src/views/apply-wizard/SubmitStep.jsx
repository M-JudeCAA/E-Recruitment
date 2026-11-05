import { useState } from 'react';
import { Check, Clock, Send } from 'lucide-react';
import client from '../../models/apiClient';
import { SOURCES, rememberedSource } from '../../utils/applicationSources';
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
//
// An Internal candidate whose UCAA employment HR hasn't verified yet can't
// send it now, but can choose "Submit when verified": every other check runs
// now and the application goes in by itself once HR verifies them - on time
// if set before the deadline (backend applicationSubmissionService). queuedAt
// is when they set it (Application.submitWhenVerifiedAt); onQueued(application)
// and onUnqueued(application) report the change.
export default function SubmitStep({ vacancy, applicationId, status, eligibility, goToStep, onSubmitted, onWithdrawn, queuedAt = null, onQueued, onUnqueued }) {
  const confirm = useConfirm();
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  // Where they saw the advert - optional, for the Source of Hire report.
  const [source, setSource] = useState(rememberedSource());
  const [sourceDetail, setSourceDetail] = useState('');

  // applicationId should always be set by the time this step is reachable
  // (ApplyForm.jsx now auto-saves a draft when leaving Documents/Questions)
  // - this guard is only a last line of defense against a request firing
  // at /api/applications/undefined/submit if that save ever failed silently.
  const handleSubmit = async () => {
    if (!applicationId) { setError('Your application draft has not finished saving yet - please go back a step and try again.'); return; }
    if (!consent) { setError('Please confirm your consent to the processing of your personal data before sending.'); return; }
    setError(''); setRefusal(null); setBusy(true);
    try {
      await client.patch(`/api/applications/${applicationId}/submit`, { consent: true, source: source || undefined, sourceDetail: sourceDetail || undefined });
      onSubmitted();
    } catch (err) {
      if (err.response?.data?.code === 'NOT_ELIGIBLE') setRefusal(err.response.data.reasons || []);
      else setError(err.response?.data?.error || 'Submission failed');
    } finally {
      setBusy(false);
    }
  };

  const handleQueue = async () => {
    if (!applicationId) { setError('Your application draft has not finished saving yet - please go back a step and try again.'); return; }
    if (!consent) { setError('Please confirm your consent to the processing of your personal data first.'); return; }
    setError(''); setRefusal(null); setBusy(true);
    try {
      const { data } = await client.post(`/api/applications/${applicationId}/submit-when-verified`, { consent: true, source: source || undefined, sourceDetail: sourceDetail || undefined });
      if (data.submitted) onSubmitted();
      else onQueued?.(data.application);
    } catch (err) {
      if (err.response?.data?.code === 'NOT_ELIGIBLE') setRefusal(err.response.data.reasons || []);
      else setError(err.response?.data?.error || 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  const handleUnqueue = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await client.delete(`/api/applications/${applicationId}/submit-when-verified`);
      onUnqueued?.(data);
    } catch (err) {
      setError(err.response?.data?.error || 'That did not go through');
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

  const notVerified = eligibility?.employmentCheck && !eligibility.employmentCheck.verified;
  if (queuedAt && status === 'Draft') {
    return (
      <div className="text-center py-6">
        <span className="inline-flex items-center justify-center mb-4" style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff' }}>
          <Clock size={24} />
        </span>
        <div style={{ fontSize: 18, color: 'var(--color-text)', fontWeight: 600, marginBottom: 6 }}>Set to submit when verified</div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 460, margin: '0 auto 12px' }}>
          Your application for <strong>{vacancy.title}</strong> will be submitted automatically as soon as HR verifies your UCAA
          employment details. It counts as on time: you set it on{' '}
          {new Date(queuedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.
        </p>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 460, margin: '0 auto 20px' }}>
          You can still change it until then - it is checked again when it goes in, and you will be told if anything stops it.
        </p>
        <button type="button" onClick={handleUnqueue} disabled={busy}
          style={{ fontSize: 13, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          Don’t submit it automatically
        </button>
        {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

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
  const missingEvidence = (eligibility?.evidence || []).filter((e) => !e.provided);
  // An internal candidate submits only once HR has verified their employment
  // (backend EMPLOYMENT_NOT_VERIFIED) - or sets it to go in when they are.
  const blocked = missingAcademic || missingEvidence.length > 0;

  return (
    <div className="text-center py-6">
      {notVerified && !missingAcademic && missingEvidence.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--color-warning)', maxWidth: 480, margin: '0 auto 24px' }}>
          {eligibility.employmentCheck.message} Choose <strong>Submit when verified</strong> and it goes in by itself the moment
          HR verifies you - it counts as on time if you do it before the deadline.
        </p>
      ) : missingAcademic ? (
        <p style={{ fontSize: 14, color: 'var(--color-danger)', maxWidth: 420, margin: '0 auto 24px' }}>
          Please attach at least one academic document before sending.{' '}
          <button type="button" onClick={() => goToStep('documents')}
            style={{ fontSize: 14, color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
            Go to Documents
          </button>
        </p>
      ) : missingEvidence.length > 0 ? (
        <div style={{ fontSize: 14, color: 'var(--color-danger)', maxWidth: 460, margin: '0 auto 24px', textAlign: 'left' }}>
          Please attach the evidence for:
          <ul style={{ margin: '6px 0' }}>{missingEvidence.map((e) => <li key={e.key}>{e.label}</li>)}</ul>
          <button type="button" onClick={() => goToStep('documents')}
            style={{ fontSize: 14, color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
            Go to Documents
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24, maxWidth: 420, margin: '0 auto 24px' }}>
          {eligibility?.eligible ? "You meet this role's requirements. " : ''}Once you send this, UCAA will confirm receipt by email.
        </p>
      )}
      <div style={{ maxWidth: 460, margin: '0 auto 16px', textAlign: 'left' }}>
        <label htmlFor="advert-source" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Where did you see this advert? (optional)</label>
        <select id="advert-source" value={source} onChange={(e) => setSource(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 14, minWidth: 240 }}>
          <option value="">Choose one</option>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {['Referral', 'Other', 'JobBoard'].includes(source) && (
          <input aria-label="Tell us where" placeholder={source === 'Referral' ? 'Who told you? (optional)' : 'Where? (optional)'} value={sourceDetail}
            onChange={(e) => setSourceDetail(e.target.value)} maxLength={200}
            style={{ display: 'block', marginTop: 8, padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 14, width: '100%', maxWidth: 400 }} />
        )}
      </div>

      {/* FR-ATS-038 - explicit consent, never pre-ticked. */}
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', fontSize: 13, maxWidth: 460, margin: '0 auto 20px', cursor: 'pointer' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} />
        <span>
          I consent to UCAA processing and keeping the personal data in this application to assess it and, if I am selected,
          to appoint me, as described in the{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">privacy notice</a>.
        </span>
      </label>
      <button onClick={notVerified ? handleQueue : handleSubmit} disabled={busy || blocked || !consent}
        className="inline-flex items-center gap-2"
        style={{ background: 'var(--color-primary)', color: '#fff', padding: '12px 28px', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600, border: 'none', cursor: (busy || blocked || !consent) ? 'not-allowed' : 'pointer', opacity: (busy || blocked || !consent) ? 0.6 : 1 }}>
        {notVerified
          ? <><Clock size={15} /> {busy ? 'Saving...' : 'Submit when verified'}</>
          : <><Send size={15} /> {busy ? 'Sending...' : 'Send application'}</>}
      </button>
      {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 16 }}>{error}</p>}
    </div>
  );
}
