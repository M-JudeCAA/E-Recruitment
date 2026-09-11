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
export default function CvAutofillPanel({ onLinkedinSuggested, onEducationSuggested, onWorkExperienceSuggested }) {
  const [mode, setMode] = useState('manual');
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

  const hasSuggestions = result && (result.linkedinUrl || result.education?.length || result.workExperience?.length);

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: mode === 'upload' ? 12 : 0 }}>
        <Button type="button" variant={mode === 'manual' ? 'primary' : 'ghost'} onClick={() => setMode('manual')}>
          Fill in manually
        </Button>
        <Button type="button" variant={mode === 'upload' ? 'primary' : 'ghost'} onClick={() => setMode('upload')}>
          Upload a CV to autofill
        </Button>
      </div>

      {mode === 'upload' && (
        <div>
          <Alert type="info" message="Autofill from an uploaded CV uses best-effort text extraction and may misread your personal layout - please review every suggestion carefully before adding it, and check every field again before saving. The file itself is not kept once you save your profile." />
          <input type="file" accept=".pdf,.docx" onChange={handleFile} disabled={uploading} />
          {uploading && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Reading your CV...</p>}
          <Alert type="error" message={error} />

          {result && (
            <div style={{ marginTop: 12 }}>
              {hasSuggestions && (
                <Alert type="success" message="We found some details in your CV - review each suggestion below and click “Use this” to add it." />
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
                    Review & add
                  </Button>
                </div>
              ))}

              {(result.workExperience || []).map((w, i) => !applied[`work-${i}`] && (
                <div key={i} style={{ fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Found role: {w.jobTitle || '(title not detected)'}{w.startDate ? ` from ${w.startDate.slice(0, 4)}` : ''}</span>
                  <Button type="button" variant="ghost" onClick={() => { onWorkExperienceSuggested(w); setApplied((a) => ({ ...a, [`work-${i}`]: true })); }}>
                    Review & add
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
