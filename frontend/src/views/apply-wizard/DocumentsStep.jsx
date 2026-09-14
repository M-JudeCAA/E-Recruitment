import { Paperclip, X } from 'lucide-react';
import TextField from '../../components/TextField';

function AttachmentField({ label, hint, required, name, file, onChange, onClear }) {
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
          <button type="button" onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}><X size={14} /></button>
        </div>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
          <Paperclip size={14} /> Attach {name}
          <input type="file" accept=".pdf,.doc,.docx" onChange={onChange} style={{ display: 'none' }} />
        </label>
      )}
      {hint && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</span>}
    </label>
  );
}

export default function DocumentsStep({ cv, coverLetter, setCv, setCoverLetter, portfolioUrl, setPortfolioUrl }) {
  return (
    <div>
      <AttachmentField label="CV / Resume" required hint="PDF or Word, up to 10MB" name="CV"
        file={cv} onChange={(e) => setCv(e.target.files[0])} onClear={() => setCv(null)} />
      <AttachmentField label="Cover letter" hint="Optional" name="cover letter"
        file={coverLetter} onChange={(e) => setCoverLetter(e.target.files[0])} onClear={() => setCoverLetter(null)} />
      <TextField label="Portfolio link" hint="Optional - certifications, work samples, personal site"
        placeholder="https://..." value={portfolioUrl} onChange={setPortfolioUrl} />
    </div>
  );
}
