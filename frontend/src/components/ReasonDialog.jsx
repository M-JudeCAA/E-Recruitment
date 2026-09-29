import React, { useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import TextArea from './TextArea';

// A decision that needs a comment - returning or rejecting a vacancy,
// closing one (BR-ATS-07). onSubmit(reason) may throw; its message is shown
// here and the dialog stays open. The server enforces the same minimum.
const MIN_LENGTH = 3;

export default function ReasonDialog({
  title, intro, label = 'Reason', hint, confirmLabel = 'Confirm', busyLabel = 'Saving...', danger = false, onSubmit, onClose
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (reason.trim().length < MIN_LENGTH) { setError('Please give a reason.'); return; }
    setBusy(true); setError('');
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={busy ? undefined : onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} disabled={busy} style={danger ? { background: 'var(--color-danger)', borderColor: 'var(--color-danger)' } : undefined}>
          {busy ? busyLabel : confirmLabel}
        </Button>
      </>}
    >
      {intro && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>{intro}</p>}
      {error && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <TextArea label={label} hint={hint} required value={reason} maxLength={2000} autoFocus onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
