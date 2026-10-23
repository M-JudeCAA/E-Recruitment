import { useState } from 'react';
import client from '../models/apiClient';
import Button from './Button';
import Alert from './Alert';

// Two CV "formats": the default here (mode 'manual') is really just the
// structured profile form itself - there's no file, so nothing to
// misread. Only the 'upload' mode involves a real file, parsed
// best-effort on the server (no AI, plain text-extraction + heuristics)
// - hence the persistent accuracy warning the moment that mode is picked.
// The uploaded file itself is never stored (see backend's parse-cv route).
// uploadOnly: just the upload, without the manual/upload switch (a page that
// opens this on purpose, e.g. My profile's "Fill in from your CV").
export default function CvAutofillPanel({ onLinkedinSuggested, onEducationSuggested, onWorkExperienceSuggested, onCertificateSuggested, uploadOnly = false }) {
  const [mode, setMode] = useState(uploadOnly ? 'upload' : 'manual');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState({});

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    setApplied({});
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('cv', file);
      const res = await client.post('/api/candidates/me/parse-cv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not read this file');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Every suggestion not yet taken, in one go.
  const addAll = () => {
    const taken = { ...applied };
    if (result.linkedinUrl && !taken.linkedin) { onLinkedinSuggested(result.linkedinUrl); taken.linkedin = true; }
    (result.education || []).forEach((e, i) => { if (!taken[`edu-${i}`]) { onEducationSuggested(e); taken[`edu-${i}`] = true; } });
    (result.workExperience || []).forEach((w, i) => { if (!taken[`work-${i}`]) { onWorkExperienceSuggested(w); taken[`work-${i}`] = true; } });
    (result.certificates || []).forEach((c, i) => { if (!taken[`cert-${i}`]) { onCertificateSuggested(c); taken[`cert-${i}`] = true; } });
    setApplied(taken);
  };

  const hasSuggestions = result && (result.linkedinUrl || result.education?.length || result.workExperience?.length || result.certificates?.length);

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 24 }}>
      {!uploadOnly && <div style={{ display: 'flex', gap: 8, marginBottom: mode === 'upload' ? 12 : 0 }}>
        <Button type="button" variant={mode === 'manual' ? 'primary' : 'ghost'} onClick={() => setMode('manual')}>
          Fill in manually
        </Button>
        <Button type="button" variant={mode === 'upload' ? 'primary' : 'ghost'} onClick={() => setMode('upload')}>
          Upload a CV to autofill
        </Button>
      </div>}

      {mode === 'upload' && (
        <div>
          <Alert type="info" message="Autofill from an uploaded CV uses best-effort text extraction and may misread your personal layout - check every entry it fills in. The file itself is not kept." />
          <input type="file" accept=".pdf,.docx" onChange={handleFile} disabled={uploading} />
          {uploading && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Reading your CV...</p>}
          <Alert type="error" message={error} />

          {result && (
            <div style={{ marginTop: 12 }}>
              {hasSuggestions && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Alert type="success" message="We found these in your CV. Add each one you want, or all of them, then check every entry - especially the dates." />
                  <Button type="button" onClick={addAll}>Add everything found</Button>
                </div>
              )}
              {result.warnings?.length > 0 && (
                <Alert type="info" message={result.warnings.join(' ')} />
              )}

              {result.linkedinUrl && !applied.linkedin && (
                <div style={{ fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Found LinkedIn: {result.linkedinUrl}</span>
                  <Button type="button" variant="ghost" onClick={() => { onLinkedinSuggested(result.linkedinUrl); setApplied((a) => ({ ...a, linkedin: true })); }}>
                    Use this
                  </Button>
                </div>
              )}

              {(result.education || []).map((edu, i) => !applied[`edu-${i}`] && (
                <div key={i} style={{ fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Found education: {edu.qualificationLevel}{edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ''}{edu.yearCompleted ? ` (${edu.yearCompleted})` : ''}</span>
                  <Button type="button" variant="ghost" onClick={() => { onEducationSuggested(edu); setApplied((a) => ({ ...a, [`edu-${i}`]: true })); }}>
                    Add
                  </Button>
                </div>
              ))}

              {(result.workExperience || []).map((w, i) => !applied[`work-${i}`] && (
                <div key={i} style={{ fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>
                    Found role: {w.jobTitle || '(title not detected)'}{w.startDate ? ` from ${w.startDate.slice(0, 4)}` : ''}
                    {w.duties?.length > 0 ? ` - ${w.duties.length} duty line${w.duties.length === 1 ? '' : 's'} detected` : ''}
                  </span>
                  <Button type="button" variant="ghost" onClick={() => { onWorkExperienceSuggested(w); setApplied((a) => ({ ...a, [`work-${i}`]: true })); }}>
                    Add
                  </Button>
                </div>
              ))}

              {(result.certificates || []).map((c, i) => !applied[`cert-${i}`] && (
                <div key={i} style={{ fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>
                    Found certificate: {c.name || '(name not detected)'}{c.issuingOrganization ? ` - ${c.issuingOrganization}` : ''}
                  </span>
                  <Button type="button" variant="ghost" onClick={() => { onCertificateSuggested(c); setApplied((a) => ({ ...a, [`cert-${i}`]: true })); }}>
                    Add
                  </Button>
                </div>
              ))}

              {!hasSuggestions && (
                <Alert type="error" message="No fields could be confidently extracted from this file - please fill in your details manually below." />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
