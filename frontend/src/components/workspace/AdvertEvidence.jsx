import React, { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Button from '../Button';
import Alert from '../Alert';
import Modal from '../Modal';
import TextField from '../TextField';
import DocumentLink from '../DocumentLink';
import { Panel, formatDay, rankOf, ROLE_RANK } from './ui';

// Evidence that a vacancy was advertised (VacancyAdvertEvidence): a scanned
// newspaper advert, a screenshot from a job board, for an internal vacancy
// the noticeboard advert or the HR Pulse email. Closing a vacancy that was
// published needs at least one (backend vacancyController.close).

export const MAX_EVIDENCE_FILES = 5;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

export function evidenceHint(vacancy) {
  return vacancy?.postingType === 'Internal'
    ? 'A scan of the noticeboard advert, or the HR Pulse email saved as PDF.'
    : 'A scanned newspaper advert, or a screenshot of the job on a job board or website.';
}

// The files and a note, sent as multipart `evidence` + `evidenceNote`.
export function appendEvidence(formData, files, note) {
  for (const f of files) formData.append('evidence', f);
  if (note.trim()) formData.append('evidenceNote', note.trim());
  return formData;
}

export function AdvertEvidenceFields({ vacancy, files, onFilesChange, note, onNoteChange, required }) {
  const [error, setError] = useState('');
  const add = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    const room = MAX_EVIDENCE_FILES - files.length;
    setError(picked.length > room ? `At most ${MAX_EVIDENCE_FILES} files.` : '');
    onFilesChange([...files, ...picked.slice(0, Math.max(room, 0))]);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        Evidence of the advert{required ? '' : ' (optional - some is already on file)'}
      </div>
      <div className="ws-note" style={{ marginBottom: 8 }}>{evidenceHint(vacancy)} PDF, JPG, PNG or WEBP, up to {MAX_EVIDENCE_FILES} files.</div>
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '2px 0' }}>
          <Paperclip size={13} /> <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.name}</span>
          <button type="button" className="ws-icon-btn" aria-label={`Remove ${f.name}`} onClick={() => onFilesChange(files.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      {files.length < MAX_EVIDENCE_FILES && (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10, margin: '6px 0 10px', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>
          <Paperclip size={14} /> {files.length ? 'Attach another file' : 'Attach a file'}
          <input type="file" multiple accept={ACCEPT} aria-label="Evidence of the advert" onChange={add} style={{ display: 'none' }} />
        </label>
      )}
      {error && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <TextField label="Where and when it was advertised" hint="Optional" placeholder={vacancy?.postingType === 'Internal' ? 'e.g. Noticeboard and HR Pulse, 12 May' : 'e.g. New Vision, 12 May; BrighterMonday'}
        value={note} maxLength={500} onChange={(e) => onNoteChange(e.target.value)} />
    </div>
  );
}

// On the vacancy page: the evidence on file, and more added (Senior HR Officer+).
export function AdvertEvidencePanel({ vacancy, staffRole, onChanged }) {
  const evidence = vacancy.advertEvidence || [];
  const canAdd = rankOf(staffRole) >= ROLE_RANK.Senior_HR_Officer;
  const [adding, setAdding] = useState(false);
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (['PendingApproval', 'Returned', 'Rejected'].includes(vacancy.status)) return null;

  const save = async () => {
    if (!files.length) { setError('Attach at least one file.'); return; }
    setBusy(true); setError('');
    try {
      await staffClient.post(`/api/vacancies/${vacancy.id}/advert-evidence`, appendEvidence(new FormData(), files, note));
      setAdding(false); setFiles([]); setNote('');
      onChanged?.('Evidence of the advert added.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add the evidence');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Evidence of the advert" note="Needed to close the vacancy."
      actions={canAdd && <Button variant="ghost" onClick={() => { setError(''); setAdding(true); }}>Add</Button>}>
      {evidence.length === 0
        ? <div className="ws-note">None yet - attach it when closing the vacancy, or add it here.</div>
        : (
          <div style={{ display: 'grid', gap: 6 }}>
            {evidence.map((e) => (
              <div key={e.id} style={{ fontSize: 13 }}>
                <DocumentLink url={e.fileUrl} name={e.originalName} />
                <span className="ws-note"> · {formatDay(e.uploadedAt)}{e.uploadedBy?.name ? ` by ${e.uploadedBy.name}` : ''}</span>
                {e.note && <div className="ws-note">{e.note}</div>}
              </div>
            ))}
          </div>
        )}
      {adding && (
        <Modal title={`Evidence of the advert — ${vacancy.jobRef}`} onClose={busy ? undefined : () => setAdding(false)}
          footer={<>
            <Button variant="ghost" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            <Button disabled={busy} onClick={save}>{busy ? 'Uploading...' : 'Add evidence'}</Button>
          </>}>
          <Alert type="error" message={error} />
          <AdvertEvidenceFields vacancy={vacancy} files={files} onFilesChange={setFiles} note={note} onNoteChange={setNote} required />
        </Modal>
      )}
    </Panel>
  );
}
