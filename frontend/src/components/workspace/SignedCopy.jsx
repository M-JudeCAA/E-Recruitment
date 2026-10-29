import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Button from '../Button';
import Modal from '../Modal';
import TextArea from '../TextArea';
import Alert from '../Alert';
import DocumentLink from '../DocumentLink';
import { rankOf, ROLE_RANK } from './ui';

// The signed requisition copy on the vacancy's Requisition panel, with
// Replace and the history of replacements (backend
// requisitionSignedCopyService): anyone in HR before approval, a Senior HR
// Officer or above with a reason after. A delegation can also allow it -
// the API decides; this only decides whether to offer the button.

const ACCEPT = 'application/pdf,image/jpeg,image/png';
const MIN_REASON = 10;
const roleWords = (role) => (role ? role.replace(/_/g, ' ') : 'no HR role');
const when = (value) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function canReplace(vacancy, staffRole) {
  const rank = rankOf(staffRole);
  if (vacancy.approvedAt) return rank >= ROLE_RANK.Senior_HR_Officer;
  return ['PendingApproval', 'Returned'].includes(vacancy.status) && rank >= ROLE_RANK.HR_Officer;
}

function ReplaceDialog({ vacancy, onClose, onReplaced }) {
  const afterApproval = Boolean(vacancy.approvedAt);
  const [file, setFile] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reasonOk = !afterApproval || reason.trim().length >= MIN_REASON;

  const save = async () => {
    if (!file) { setError('Choose the scan of the signed requisition.'); return; }
    if (!reasonOk) { setError(`Say why it is being replaced (at least ${MIN_REASON} characters).`); return; }
    const body = new FormData();
    body.append('document', file);
    if (reason.trim()) body.append('reason', reason.trim());
    setBusy(true); setError('');
    try {
      await staffClient.put(`/api/vacancies/${vacancy.id}/requisition/signed-copy`, body);
      onReplaced();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not replace the signed copy');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Replace the signed copy" maxWidth={480} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button onClick={save} loading={busy} loadingText="Uploading..." disabled={!file || !reasonOk}>Replace</Button>
    </>}>
      <p className="ws-note" style={{ marginTop: 0 }}>
        {afterApproval
          ? 'This vacancy has been approved. The new scan replaces the current one; both are kept, with your name, the time and your reason, in the vacancy\'s history.'
          : 'The new scan replaces the current one before the vacancy is approved. Both are kept in the vacancy\'s history.'}
      </p>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }} htmlFor="signed-copy-file">Signed requisition (PDF, JPG or PNG)</label>
      <input id="signed-copy-file" type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }} style={{ marginBottom: 12 }} />
      <TextArea
        label={afterApproval ? 'Reason for replacing it' : 'Reason for replacing it (optional)'}
        required={afterApproval} rows={3} maxLength={2000} value={reason}
        hint={afterApproval ? `At least ${MIN_REASON} characters - kept for the audit trail.` : 'Kept for the audit trail.'}
        onChange={(e) => { setReason(e.target.value); setError(''); }} />
      <Alert type="error" message={error} />
    </Modal>
  );
}

export default function SignedCopy({ vacancy, staffRole, onChanged }) {
  const [history, setHistory] = useState([]);
  const [open, setOpen] = useState(false);
  const loadHistory = useCallback(() => {
    staffClient.get(`/api/vacancies/${vacancy.id}/requisition/signed-copy/history`)
      .then((r) => setHistory(r.data || []))
      .catch(() => setHistory([]));
  }, [vacancy.id]);
  useEffect(() => { loadHistory(); }, [loadHistory, vacancy.requisitionSignedCopyUrl]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Signed copy:</span>
        {vacancy.requisitionSignedCopyUrl
          ? <DocumentLink url={vacancy.requisitionSignedCopyUrl} name={vacancy.requisitionSignedCopyName || 'Signed requisition'} />
          : <span className="ws-note">none - created before the signed scan was required</span>}
        {canReplace(vacancy, staffRole) && (
          <Button variant="ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setOpen(true)}>
            <RefreshCw size={12} /> {vacancy.requisitionSignedCopyUrl ? 'Replace' : 'Attach'}
          </Button>
        )}
      </div>
      {history.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="ws-note" style={{ fontWeight: 600, marginBottom: 4 }}>Signed copy history</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 6 }}>
            {history.map((h) => (
              <li key={h.id}>
                <strong>{when(h.changedAt)}</strong> - {h.changedBy?.name || 'Someone'} ({roleWords(h.changedByRole)}{h.actingFor ? `, acting for ${h.actingFor}` : ''})
                {' '}replaced {h.previousUrl ? <DocumentLink url={h.previousUrl} name={h.previousName || 'the earlier copy'} /> : 'the earlier copy'}
                {' '}with <DocumentLink url={h.newUrl} name={h.newName || 'the new copy'} />
                {h.afterApproval ? ', after the vacancy was approved' : ', before approval'}.
                {h.reason && <div className="ws-note">Reason: {h.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && (
        <ReplaceDialog vacancy={vacancy} onClose={() => setOpen(false)}
          onReplaced={() => { setOpen(false); loadHistory(); onChanged?.('Signed copy replaced. The change is in its history.'); }} />
      )}
    </div>
  );
}
