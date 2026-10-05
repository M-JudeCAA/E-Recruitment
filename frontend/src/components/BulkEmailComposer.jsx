import React, { useEffect, useState } from 'react';
import { Send, Eye } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Modal from './Modal';
import Button from './Button';
import Select from './Select';
import TextField from './TextField';
import RichTextField from './RichTextField';

// Email many candidates at once from a template (backend
// bulkEmailController; FR-ATS-050). `applicationIds` (from a vacancy's
// board) or `candidateIds` (from the candidate search). The subject and
// wording can be changed for this send; {{placeholders}} are filled for
// each person - preview shows the first copy.

export default function BulkEmailComposer({ applicationIds, candidateIds, count, onClose, onSent }) {
  const [templates, setTemplates] = useState([]);
  const [key, setKey] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const recipients = applicationIds?.length ? { applicationIds } : { candidateIds };

  useEffect(() => {
    staffClient.get('/api/bulk-email/templates').then((res) => {
      setTemplates(res.data);
      if (res.data[0]) { setKey(res.data[0].key); setSubject(res.data[0].subject); setBody(res.data[0].body); }
    }).catch((err) => setError(err.response?.data?.error || 'Could not load the email templates'));
  }, []);
  const pick = (k) => {
    const t = templates.find((x) => x.key === k);
    setKey(k); setPreview(null);
    if (t) { setSubject(t.subject); setBody(t.body); }
  };
  const run = async (which, fn) => {
    setBusy(which); setError('');
    try { await fn(); } catch (err) { setError(err.response?.data?.error || 'That did not work'); } finally { setBusy(''); }
  };
  const showPreview = () => run('preview', async () => {
    setPreview((await staffClient.post('/api/bulk-email/preview', { templateKey: key, subject, body, ...recipients })).data);
  });
  const send = () => run('send', async () => {
    const res = await staffClient.post('/api/bulk-email/send', { templateKey: key, subject, body, ...recipients });
    onSent?.(res.data);
  });
  const placeholders = templates.find((t) => t.key === key)?.placeholders || [];

  return (
    <Modal title={`Email ${count} candidate${count === 1 ? '' : 's'}`} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
      <Button variant="secondary" onClick={showPreview} loading={busy === 'preview'}><Eye size={14} /> Preview</Button>
      <Button onClick={send} loading={busy === 'send'} loadingText="Sending..." disabled={!subject.trim()}><Send size={14} /> Send to {count}</Button>
    </>}>
      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <Select label="Start from" value={key} onChange={(e) => pick(e.target.value)}>
        {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
      </Select>
      <TextField label="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} />
      <RichTextField label="Message" value={body} onChange={(v) => { setBody(v); setPreview(null); }} />
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        Filled in for each person: {placeholders.map((p) => `{{${p.key}}}`).join(' ')}. Change the wording here for this send only - the template
        itself is edited on the Document templates page.
      </p>
      {preview && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 10, fontSize: 13 }}>
          <div style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Goes to {preview.count}: {preview.recipients.slice(0, 5).map((r) => r.name).join(', ')}{preview.count > 5 ? ', ...' : ''}
          </div>
          <div><strong>{preview.subject}</strong></div>
          {/* Sanitised on the server (the same rules as job adverts). */}
          <div dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      )}
    </Modal>
  );
}
