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
//
// Everything read is added to the form at once - no list of suggestions to
// click through - and a short summary says what went in and what was
// skipped. Each handler reports what it did, for that summary:
//   onEducationSuggested / onWorkExperienceSuggested / onCertificateSuggested(values)
//     -> true when added, 'incomplete' when added but a required field is
//     missing (the entry opens for it), false when the profile already has it;
//   onPersonalSuggested(details) -> the labels of what it filled in (only
//     what the profile lacked); details are place of residence, district of
//     origin, date of birth, NIN unless withNationalId is false, website;
//   onLinkedinSuggested(url) -> true when added (only when there was none);
//   onExamGradesSuggested(grades) -> how many O-Level / A-Level results it added.
// Any of them may answer with a promise.
const PERSONAL = [
  ['location', 'Place of residence'], ['districtOfOrigin', 'District of origin'], ['dateOfBirth', 'Date of birth'],
  ['nationalId', 'NIN'], ['portfolioUrl', 'Website']
];
const ENTRIES = [
  ['education', 'onEducationSuggested', 'qualification'],
  ['workExperience', 'onWorkExperienceSuggested', 'job'],
  ['certificates', 'onCertificateSuggested', 'certificate']
];
const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const sentence = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]);

export default function CvAutofillPanel(props) {
  const { onLinkedinSuggested, onPersonalSuggested, onExamGradesSuggested, withNationalId = true, uploadOnly = false } = props;
  const [mode, setMode] = useState(uploadOnly ? 'upload' : 'manual');
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState(null); // { added, skipped, incomplete, warnings, nothing }
  const [error, setError] = useState('');

  // Puts everything read into the form and says what happened.
  const apply = async (result) => {
    const added = [];
    const skipped = [];
    const incomplete = [];
    for (const [key, handler, noun] of ENTRIES) {
      const found = result[key] || [];
      if (!found.length || !props[handler]) continue;
      let took = 0;
      let open = 0;
      for (const values of found) {
        const outcome = await props[handler](values);
        if (outcome) took += 1;
        if (outcome === 'incomplete') open += 1;
      }
      if (open) incomplete.push(plural(open, noun));
      if (took) added.push(plural(took, noun));
      if (found.length - took) skipped.push(plural(found.length - took, noun));
    }
    const personal = Object.fromEntries(PERSONAL.filter(([k]) => result[k] && (withNationalId || k !== 'nationalId')).map(([k]) => [k, result[k]]));
    if (Object.keys(personal).length && onPersonalSuggested) {
      const filled = (await onPersonalSuggested(personal)) || [];
      if (filled.length) added.push(`your ${sentence(filled.map((l) => l.toLowerCase()))}`);
    }
    if (result.linkedinUrl && onLinkedinSuggested && (await onLinkedinSuggested(result.linkedinUrl))) added.push('your LinkedIn');
    if (result.examGrades?.length && onExamGradesSuggested) {
      const n = (await onExamGradesSuggested(result.examGrades)) || 0;
      if (n) added.push(plural(n, 'O-Level / A-Level result'));
    }
    const foundAnything = ENTRIES.some(([key]) => result[key]?.length) || Object.keys(personal).length || result.linkedinUrl || result.examGrades?.length;
    setSummary({ added, skipped, incomplete, warnings: result.warnings || [], nothing: !foundAnything });
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSummary(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('cv', file);
      const res = await client.post('/api/candidates/me/parse-cv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      await apply(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not read this file');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

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
          <Alert type="info" message="Your CV is read and its details are added to your profile straight away. Reading a CV is best-effort and may misread your layout - check every entry, especially the dates. The file itself is not kept." />
          <input type="file" accept=".pdf,.docx" onChange={handleFile} disabled={uploading} aria-label="Upload your CV" />
          {uploading && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Reading your CV and filling in your profile...</p>}
          <Alert type="error" message={error} />

          {summary && (
            <div style={{ marginTop: 12 }} role="status">
              {summary.nothing ? (
                <Alert type="error" message="Nothing could be read from this file with confidence - please fill in your details by hand." />
              ) : (
                <Alert type={summary.added.length ? 'success' : 'info'} message={[
                  summary.added.length ? `Added from your CV: ${sentence(summary.added)}.` : 'Nothing new was added.',
                  summary.skipped.length ? `Skipped ${sentence(summary.skipped)} already on your profile.` : '',
                  summary.incomplete.length ? `${sentence(summary.incomplete)} still ${summary.incomplete.length === 1 && summary.incomplete[0].startsWith('1 ') ? 'needs' : 'need'} a detail the CV did not give - open below for you to fill in.` : '',
                  summary.added.length ? 'Check each entry below - use Edit to correct one, Delete to drop it.' : ''
                ].filter(Boolean).join(' ')} />
              )}
              {summary.warnings.length > 0 && <Alert type="info" message={summary.warnings.join(' ')} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
