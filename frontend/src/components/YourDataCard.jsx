import React, { useEffect, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import client from '../models/apiClient';
import Card from './Card';
import Button from './Button';
import Alert from './Alert';
import Modal from './Modal';
import TextArea from './TextArea';
import StatusBadge from './StatusBadge';

// The candidate's rights over their data (FR-ATS-079/080): a copy of
// everything held about them, and a request to erase it, which an HR
// Manager deals with (backend dataProtectionController).
export default function YourDataCard() {
  const [requests, setRequests] = useState([]);
  const [modal, setModal] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => client.get('/api/candidates/me/data-requests').then((res) => setRequests(res.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const pending = requests.find((r) => r.status === 'Pending');

  const download = async () => {
    setBusy('download'); setError('');
    try {
      const res = await client.get('/api/candidates/me/data-export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'my-ucaa-recruitment-data.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Could not prepare your data - please try again.');
    } finally {
      setBusy('');
    }
  };

  const ask = async () => {
    setBusy('ask'); setError('');
    try {
      await client.post('/api/candidates/me/data-requests', { reason });
      setModal(false); setReason('');
      setNotice('Your request has been sent to UCAA Human Resources. You will hear by email once it has been dealt with.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send your request');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card style={{ marginTop: 'var(--spacing-md)' }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Your data</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Download a copy of everything we hold about you, or ask for it to be erased. Erasing closes your account; an application still in
        progress has to be finished or withdrawn first. See the <a href="/privacy" target="_blank" rel="noreferrer">privacy notice</a>.
      </p>
      <Alert type="error" message={error} />
      <Alert type="success" message={notice} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={download} loading={busy === 'download'}><Download size={14} /> Download my data</Button>
        <Button variant="ghost" onClick={() => setModal(true)} disabled={!!pending} title={pending ? 'You already have a request waiting' : undefined}>
          <Trash2 size={14} /> Ask for my data to be erased
        </Button>
      </div>
      {requests.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          {requests.map((r) => (
            <div key={r.id} style={{ padding: '6px 0', borderTop: '1px solid var(--color-border)' }}>
              Erasure request of {new Date(r.createdAt).toLocaleDateString()}{' '}
              <StatusBadge status={r.status === 'Refused' ? 'Rejected' : r.status === 'Completed' ? 'Completed' : 'Pending'} label={r.status === 'Pending' ? 'Waiting' : r.status} />
              {r.decisionReason && <div style={{ color: 'var(--color-text-muted)' }}>Reason: {r.decisionReason}</div>}
            </div>
          ))}
        </div>
      )}
      {modal && (
        <Modal title="Erase my data" onClose={() => setModal(false)} footer={<>
          <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="danger" onClick={ask} loading={busy === 'ask'}>Send request</Button>
        </>}>
          <p style={{ marginTop: 0 }}>
            UCAA Human Resources will erase your profile, documents and the details of your applications, and close your account. This can't be undone.
          </p>
          <TextArea label="Anything you'd like us to know (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </Card>
  );
}
