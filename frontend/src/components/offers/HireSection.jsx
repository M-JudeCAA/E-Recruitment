import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Download, RefreshCw, Upload } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Button from '../Button';
import Modal from '../Modal';
import { errorMessage } from '../../utils/interviews';

// "Mark as Hired" on an accepted offer (backend hireController): a Principal
// HR Officer+ attaches the signed appointing instrument and the system opens
// one onboarding case (UCAA/ONB/NNN/YYYY) for the HRIS. Marking twice never
// makes a second case. Then: the case, whether the HRIS has it, the package
// to pass on by hand while no HRIS link is set up, and a retry.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
const small = { padding: '4px 10px', fontSize: 12 };

const HANDOFF_TEXT = {
  NotConfigured: 'No HRIS connection yet - download the package and pass it to the onboarding team.',
  Pending: 'Waiting to reach the HRIS - it is retried automatically.',
  Sent: 'Received by the HRIS.',
  Failed: 'The HRIS could not be reached after several tries - retry, or pass the package on by hand.'
};

// onHire(hire | null) tells the parent once it is known whether the candidate
// has been marked hired (OfferActions offers withdrawing an accepted offer
// only until then).
export default function HireSection({ offer, staffRole, onChanged, onHire }) {
  const canHire = (ROLE_RANK[staffRole] || 0) >= ROLE_RANK.Principal_HR_Officer;
  const [hire, setHire] = useState(undefined);
  const [modal, setModal] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => staffClient.get(`/api/applications/offers/${offer.id}/hire`)
    .then((res) => setHire(res.data))
    .catch((err) => setHire(err.response?.status === 404 ? null : undefined)), [offer.id]);
  useEffect(() => { if (offer.status === 'Accepted') load(); }, [offer.status, load]);
  useEffect(() => { if (hire !== undefined) onHire?.(hire); }, [hire, onHire]);
  if (offer.status !== 'Accepted' || hire === undefined) return null;

  const markHired = async () => {
    setBusy('hire'); setError('');
    try {
      const form = new FormData();
      form.append('signedInstrument', file);
      const res = await staffClient.post(`/api/applications/offers/${offer.id}/hire`, form);
      setHire(res.data); setModal(false); setFile(null);
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not mark as hired'));
    } finally {
      setBusy('');
    }
  };

  const download = async () => {
    setError('');
    try {
      const res = await staffClient.get(`/api/applications/offers/${offer.id}/hire/package`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `onboarding-${hire.caseRef.replace(/\//g, '-')}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(errorMessage(err, 'Could not download the package'));
    }
  };

  const retry = async () => {
    setBusy('retry'); setError('');
    try {
      setHire((await staffClient.post(`/api/applications/offers/${offer.id}/hire/retry`)).data);
    } catch (err) {
      setError(errorMessage(err, 'Could not send it'));
    } finally {
      setBusy('');
    }
  };

  if (!hire) {
    if (!canHire) return null;
    return (
      <div style={{ marginTop: 6 }}>
        <Button style={small} onClick={() => { setError(''); setModal(true); }}><BadgeCheck size={13} /> Mark as hired</Button>
        {modal && (
          <Modal title="Mark as hired" onClose={() => setModal(false)} footer={<>
            <Button variant="ghost" onClick={() => setModal(false)} disabled={!!busy}>Cancel</Button>
            <Button onClick={markHired} loading={busy === 'hire'} loadingText="Saving..." disabled={!file}><BadgeCheck size={14} /> Mark as hired</Button>
          </>}>
            {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
              Attach the appointing instrument as signed (a PDF or a scan). An onboarding case is opened with the candidate's profile,
              contact details, the offer terms and the signed documents, for the HRIS. This is done once - marking again changes nothing.
            </p>
            <label style={{ fontSize: 13, display: 'block' }}>
              <Upload size={13} /> Signed appointing instrument (PDF, JPG or PNG)
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style={{ display: 'block', marginTop: 6 }}
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <BadgeCheck size={15} color="var(--color-accent)" />
        <strong>Hired</strong> &middot; onboarding case {hire.caseRef}
        <span style={{ color: 'var(--color-text-muted)' }}>
          {new Date(hire.hiredAt).toLocaleDateString()}{hire.hiredBy ? ` by ${hire.hiredBy.name}` : ''}
          {hire.onboardingCaseId ? ` · HRIS case ${hire.onboardingCaseId}` : ''}
        </span>
      </div>
      <div style={{ color: hire.handoffStatus === 'Failed' ? 'var(--color-danger)' : 'var(--color-text-muted)', marginTop: 4 }}>{HANDOFF_TEXT[hire.handoffStatus]}</div>
      {canHire && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <Button variant="ghost" style={small} onClick={download}><Download size={13} /> Handoff package</Button>
          {hire.hrisConfigured && hire.handoffStatus !== 'Sent' && (
            <Button variant="secondary" style={small} onClick={retry} loading={busy === 'retry'} loadingText="Sending..."><RefreshCw size={13} /> Send to HRIS now</Button>
          )}
        </div>
      )}
      {error && <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
