import { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import TextField from '../../components/TextField';
import client from '../../models/apiClient';
import { validateDocumentFile, validateSupportingDocumentFile } from '../../utils/fileValidation';
import { candidateFileSrc } from '../../utils/fileSrc';

function AttachmentField({ label, hint, required, name, file, onChange, onClear }) {
  // Rejected client-side (wrong type or too large) - kept local rather than
  // lifted to DocumentsStep since it's purely about the picker interaction,
  // not data the wizard needs to persist or send anywhere.
  const [error, setError] = useState('');

  const handleFile = (e) => {
    const selected = e.target.files[0];
    // Reset so picking the SAME file again (e.g. after fixing it outside
    // the browser) still fires a change event next time.
    e.target.value = '';
    if (!selected) return;
    const validationError = validateDocumentFile(selected);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    onChange(selected);
  };

  return (
    <label style={{ display: 'block', marginBottom: 20, maxWidth: 640 }}>
      <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
      </span>
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 8, border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text)', minWidth: 0, flex: 1 }}>
            <Paperclip size={14} style={{ flexShrink: 0 }} />
            {/* This inner span is itself a flex item of the span above (which is
                display:flex) - flex items default to min-width:auto, which
                overrides overflow/text-overflow and refuses to shrink below the
                filename's full intrinsic width no matter what the parent does.
                minWidth: 0 here (not just on the parent) is what actually lets
                it shrink and the ellipsis take effect. */}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</span>
          </span>
          <button type="button" onClick={() => { setError(''); onClear(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}><X size={14} /></button>
        </div>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
          <Paperclip size={14} /> Attach {name}
          <input type="file" accept=".pdf,.doc,.docx" onChange={handleFile} style={{ display: 'none' }} />
        </label>
      )}
      {error && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>{error}</span>}
      {hint && !error && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</span>}
    </label>
  );
}

// Academic or other supporting documents - unlike the cover letter above,
// each file is uploaded the moment it's picked (POST
// /api/applications/:id/documents) rather than held until the next draft
// save, so the list shown is always what's actually on the application.
function SupportingDocumentsSection({ title, description, category, required, labelPlaceholder, applicationId, documents, onDocumentsChange }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = documents.filter((d) => d.category === category);

  const handleFile = async (e) => {
    const selected = e.target.files[0];
    e.target.value = '';
    if (!selected) return;
    const validationError = validateSupportingDocumentFile(selected);
    if (validationError) { setError(validationError); return; }
    if (!applicationId) { setError('Your draft has not been saved yet - please go back a step and continue again.'); return; }
    setError(''); setBusy(true);
    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('label', label);
      formData.append('file', selected);
      const res = await client.post(`/api/applications/${applicationId}/documents`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      onDocumentsChange((current) => [...current, res.data]);
      setLabel('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not upload this document');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    setError(''); setBusy(true);
    try {
      await client.delete(`/api/applications/${applicationId}/documents/${doc.id}`);
      onDocumentsChange((current) => current.filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove this document');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 24, maxWidth: 640 }}>
      <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
        {title}{required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
      </span>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 10 }}>{description}</p>
      {mine.map((doc) => (
        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 8, marginBottom: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)' }}>
          <a href={candidateFileSrc(doc.fileUrl)} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, color: 'var(--color-text)' }}>
            <Paperclip size={14} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.originalName}>
              {doc.label ? `${doc.label} - ${doc.originalName}` : doc.originalName}
            </span>
          </a>
          <button type="button" onClick={() => remove(doc)} disabled={busy} aria-label={`Remove ${doc.originalName}`}
            style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', flexShrink: 0 }}><X size={14} /></button>
        </div>
      ))}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ alignItems: 'end' }}>
        <TextField label="Description" hint="Optional" placeholder={labelPlaceholder} value={label} onChange={(e) => setLabel(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 11, marginBottom: 20, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: busy ? 'default' : 'pointer' }}>
          <Paperclip size={14} /> {busy ? 'Uploading...' : 'Attach a file'}
          <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={handleFile} disabled={busy} style={{ display: 'none' }} />
        </label>
      </div>
      {error && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)', marginTop: -12 }}>{error}</span>}
    </div>
  );
}

// No CV upload here - a candidate no longer attaches their own CV file.
// HR instead generates one on demand from the structured profile/
// application data already captured across the wizard (education, work
// experience, exam grades, certificates, the Questions step answers, the
// Referees step) - see GeneratedCvPrintLayout.jsx and
// useGeneratedCvDownload.jsx. Academic documents are required (submit
// refuses an application without one); other documents are optional.
export default function DocumentsStep({
  coverLetter, setCoverLetter, portfolioUrl, setPortfolioUrl, applicationId, documents, onDocumentsChange
}) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        Your CV is generated automatically from the profile and application details you provide elsewhere in
        this form. Attach copies of your academic documents, and anything else relevant to this role. PDF, Word,
        JPG or PNG, up to 10MB each.
      </p>
      <SupportingDocumentsSection title="Academic documents" category="Academic" required
        description="Certificates, transcripts and result slips for the qualifications on your profile - at least one is required."
        labelPlaceholder="e.g. BSc transcript" applicationId={applicationId} documents={documents} onDocumentsChange={onDocumentsChange} />
      <SupportingDocumentsSection title="Other relevant documents" category="Other"
        description="Optional - professional certificates, licences, testimonials or anything else that supports your application."
        labelPlaceholder="e.g. ATC licence" applicationId={applicationId} documents={documents} onDocumentsChange={onDocumentsChange} />
      <AttachmentField label="Cover letter" hint="Optional" name="cover letter"
        file={coverLetter} onChange={setCoverLetter} onClear={() => setCoverLetter(null)} />
      <TextField label="Portfolio link" hint="Optional - certifications, work samples, personal site"
        placeholder="https://..." value={portfolioUrl} onChange={setPortfolioUrl} />
    </div>
  );
}
