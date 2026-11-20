import { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import TextField from '../../components/TextField';
import client from '../../models/apiClient';
import { validateDocumentFile, validateSupportingDocumentFile } from '../../utils/fileValidation';
import DocumentLink from '../../components/DocumentLink';

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

// An upload stops after this long instead of hanging (UAT-029).
export const UPLOAD_TIMEOUT_MS = 120000;

// What went wrong with an upload, in words the candidate can act on.
export function uploadError(err) {
  if (err.code === 'ECONNABORTED') return 'The upload took too long and was stopped - your connection may be slow. Try again, or try a smaller file.';
  if (!err.response) return 'The connection was lost while uploading. Check your connection and try again.';
  if (err.response.status === 413) return 'This file is larger than the 10 MB limit.';
  return err.response.data?.error || 'Could not upload this document.';
}

// Academic or other supporting documents - unlike the cover letter above,
// each file is uploaded the moment it's picked (POST
// /api/applications/:id/documents) rather than held until the next draft
// save, so the list shown is always what's actually on the application.
// With an evidenceKey, the section collects the evidence for one screening
// requirement (category Evidence) - labelled by the server, no description.
// single: one file only (the CV) - a new one replaces it, PDF or Word only.
// describe: a description is required before a file can be attached (the
// academic documents, whose descriptions say which requirement each covers).
// extra: documents listed besides this category's own (academic evidence
// uploaded separately on drafts from before it moved here).
// Every upload shows the allowed types and the 10 MB limit, its progress,
// and - after a time-out or a lost connection - a Retry that sends the same
// file again (UAT-015, UAT-029).
function SupportingDocumentsSection({
  title, description, category, required, labelPlaceholder, applicationId, documents, onDocumentsChange, evidenceKey,
  single = false, describe = false, describeHint, extra = [], children
}) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [failed, setFailed] = useState(null); // { file, label } of an upload that can be sent again
  const mine = [...documents.filter((d) => d.category === category && (!evidenceKey || d.evidenceKey === evidenceKey)), ...extra];
  const needsLabel = describe && !label.trim();

  const upload = async (selected, withLabel) => {
    if (!applicationId) { setError('Your draft has not been saved yet - please go back a step and continue again.'); return; }
    setError(''); setFailed(null); setBusy(true); setProgress(0);
    try {
      const formData = new FormData();
      formData.append('category', category);
      if (evidenceKey) formData.append('evidenceKey', evidenceKey);
      else if (!single) formData.append('label', withLabel);
      formData.append('file', selected);
      const res = await client.post(`/api/applications/${applicationId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: UPLOAD_TIMEOUT_MS,
        onUploadProgress: (e) => { if (e.total) setProgress(Math.round((e.loaded / e.total) * 100)); }
      });
      onDocumentsChange((current) => [...(single ? current.filter((d) => d.category !== category) : current), res.data]);
      setLabel('');
    } catch (err) {
      setError(uploadError(err));
      // A refusal of the file itself (type, size, description) needs a change;
      // a time-out, lost connection or server failure can simply be retried.
      if (!err.response || err.response.status >= 500) setFailed({ file: selected, label: withLabel });
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  const handleFile = (e) => {
    const selected = e.target.files[0];
    e.target.value = '';
    if (!selected) return;
    const validationError = validateSupportingDocumentFile(selected);
    if (validationError) { setError(validationError); setFailed(null); return; }
    upload(selected, label.trim());
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

  const blocked = busy || needsLabel;
  return (
    <div style={{ marginBottom: 24, maxWidth: 640 }}>
      <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
        {title}{required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
      </span>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 10 }}>{description}</p>
      {children}
      {mine.map((doc) => (
        <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 8, marginBottom: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)' }}>
          <DocumentLink url={doc.fileUrl} audience="candidate" name={doc.label ? `${doc.label} - ${doc.originalName}` : doc.originalName}
            style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, color: 'var(--color-text)' }}>
            <Paperclip size={14} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.originalName}>
              {doc.label ? `${doc.label} - ${doc.originalName}` : doc.originalName}
            </span>
          </DocumentLink>
          <button type="button" onClick={() => remove(doc)} disabled={busy} aria-label={`Remove ${doc.originalName}`}
            style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', flexShrink: 0 }}><X size={14} /></button>
        </div>
      ))}
      <div className={evidenceKey || single ? '' : 'grid grid-cols-1 md:grid-cols-2 gap-x-4'} style={{ alignItems: 'end' }}>
        {!evidenceKey && !single && (
          <TextField label="Description" required={describe} hint={describe ? describeHint : 'Optional'} placeholder={labelPlaceholder}
            value={label} onChange={(e) => setLabel(e.target.value)} />
        )}
        <label title={needsLabel ? 'Describe the document first' : undefined}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 11, marginBottom: 20, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: blocked ? 'not-allowed' : 'pointer', opacity: needsLabel ? 0.6 : 1 }}>
          <Paperclip size={14} /> {busy ? `Uploading${progress != null ? ` ${progress}%` : '...'}` : single && mine.length ? 'Replace it with another file' : 'Attach a file'}
          <input type="file" accept={single ? '.pdf,.doc,.docx' : '.pdf,.doc,.docx,.jpg,.jpeg,.png'} onChange={handleFile} disabled={blocked} style={{ display: 'none' }} />
        </label>
      </div>
      {busy && progress != null && (
        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress"
          style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, marginTop: -14, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.2s' }} />
        </div>
      )}
      <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: -12 }}>
        {single ? 'PDF or Word' : 'PDF, Word, JPG or PNG'}, up to 10 MB{single ? '' : ' each'}.
        {needsLabel ? ' Describe the document first, then attach it.' : ''}
      </span>
      {error && (
        <span role="alert" style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>
          {error}{' '}
          {failed && (
            <button type="button" onClick={() => upload(failed.file, failed.label)}
              style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  );
}

// The candidate's own CV is optional (one file, PDF or Word): HR also gets a
// CV the system generates from the profile and application details captured
// across the wizard - see GeneratedCvPrintLayout.jsx and GeneratedCvLink.jsx -
// and sees both wherever the applicant's details are shown. Academic
// documents are required (submit refuses an application without one); other
// documents are optional.
//
// Academic evidence (a transcript for a CGPA, result slips for exam grades,
// a degree certificate for a "Do you hold ...?" question) isn't uploaded a
// second time (UAT-031): it is listed under Academic documents, whose
// descriptions say which of it each document is. "Evidence for this role"
// keeps everything else (proof of age, experience, flying hours, licences).
export default function DocumentsStep({
  coverLetter, setCoverLetter, applicationId, documents, onDocumentsChange, evidence = []
}) {
  const academicAsked = evidence.filter((e) => e.academic);
  const otherEvidence = evidence.filter((e) => !e.academic);
  const academicKeys = new Set(academicAsked.map((e) => e.key));
  const earlierAcademicEvidence = documents.filter((d) => d.category === 'Evidence' && academicKeys.has(d.evidenceKey));
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        A CV is generated automatically from the profile and application details you provide in this form, and you
        can also attach your own. Attach copies of your academic documents, and anything else relevant to this role.
        Each file can be up to 10 MB.
      </p>
      <SupportingDocumentsSection title="Your CV" category="CV" single
        description="Optional - your own CV, PDF or Word. HR sees it alongside the CV generated from your profile."
        applicationId={applicationId} documents={documents} onDocumentsChange={onDocumentsChange} />
      <SupportingDocumentsSection title="Academic documents" category="Academic" required describe
        description={academicAsked.length
          ? 'Certificates, transcripts and result slips for the qualifications on your profile - at least one is required. Upload each document once: it also serves as the academic evidence this role asks for.'
          : 'Certificates, transcripts and result slips for the qualifications on your profile - at least one is required.'}
        describeHint={academicAsked.length ? 'Say what it is, using the wording of the list above where it applies' : 'Say what the document is'}
        labelPlaceholder="e.g. BSc Computer Science degree certificate" extra={earlierAcademicEvidence}
        applicationId={applicationId} documents={documents} onDocumentsChange={onDocumentsChange}>
        {academicAsked.length > 0 && (
          <div style={{ padding: '10px 12px', marginBottom: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)', fontSize: 13 }}>
            <strong>This role asks for this academic evidence:</strong>
            <ul style={{ margin: '6px 0 6px 18px', padding: 0 }}>
              {academicAsked.map((e) => <li key={e.key}>{e.label}<span style={{ color: 'var(--color-text-muted)' }}> - {e.hint}</span></li>)}
            </ul>
            <span style={{ color: 'var(--color-text-muted)' }}>
              Make sure your academic documents include these, and describe each one by what it is - for example
              “BSc Computer Science transcript (CGPA 3.8)” or “UCE and UACE result slips” - so HR and the shortlisting
              committee can match it to the requirement.
            </span>
          </div>
        )}
      </SupportingDocumentsSection>
      {otherEvidence.length > 0 && (
        <div style={{ marginBottom: 8, maxWidth: 640 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Evidence for this role</span>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 14 }}>
            This role's other requirements, and the questions you answered Yes to, need proof. Attach a copy of each - your application can't be sent without them.
          </p>
          {otherEvidence.map((item) => (
            <SupportingDocumentsSection key={item.key} title={item.label} description={item.hint} category="Evidence" evidenceKey={item.key} required
              applicationId={applicationId} documents={documents} onDocumentsChange={onDocumentsChange} />
          ))}
        </div>
      )}
      <SupportingDocumentsSection title="Other relevant documents" category="Other"
        description="Optional - professional certificates, licences, testimonials or anything else that supports your application."
        labelPlaceholder="e.g. ATC licence" applicationId={applicationId} documents={documents} onDocumentsChange={onDocumentsChange} />
      <AttachmentField label="Cover letter" hint="Optional - PDF or Word, up to 10 MB." name="cover letter"
        file={coverLetter} onChange={setCoverLetter} onClear={() => setCoverLetter(null)} />
    </div>
  );
}
