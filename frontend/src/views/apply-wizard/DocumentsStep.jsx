import { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import TextField from '../../components/TextField';
import { validateDocumentFile } from '../../utils/fileValidation';

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

export default function DocumentsStep({ cv, coverLetter, setCv, setCoverLetter, portfolioUrl, setPortfolioUrl }) {
  return (
    <div>
      <AttachmentField label="CV / Resume" required hint="PDF or Word, up to 10MB" name="CV"
        file={cv} onChange={setCv} onClear={() => setCv(null)} />
      <AttachmentField label="Cover letter" hint="Optional" name="cover letter"
        file={coverLetter} onChange={setCoverLetter} onClear={() => setCoverLetter(null)} />
      <TextField label="Portfolio link" hint="Optional - certifications, work samples, personal site"
        placeholder="https://..." value={portfolioUrl} onChange={setPortfolioUrl} />
    </div>
  );
}
