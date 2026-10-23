import React, { useRef, useState } from 'react';
import client from '../../models/apiClient';
import Alert from '../../components/Alert';
import CvAutofillPanel from '../../components/CvAutofillPanel';
import ProfileEntriesEditor from '../../components/ProfileEntriesEditor';

// "Fill in from your CV" on My profile: the CV is read on the server
// (POST /api/candidates/me/parse-cv, nothing kept) and each suggestion the
// candidate takes becomes an entry in the editor below (personal details
// and O-Level / A-Level results go straight to the profile) - filled in, saved
// like one typed by hand, and marked "from your CV" so its dates get checked
// (the least reliable part of reading a CV). One the profile already has is
// skipped.
export default function CvImport({ profile, onAdded }) {
  const editor = useRef(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const take = (kind, what) => (values) => {
    setError('');
    setNotice(editor.current?.addFromCv(kind, values)
      ? `${what} added below - check it${kind === 'education' ? '' : ', especially its dates'}.`
      : `That ${what.toLowerCase()} is already on your profile - skipped.`);
  };

  // Personal details fill only what the profile doesn't have yet.
  const LABELS = { location: 'place of residence', districtOfOrigin: 'district of origin', dateOfBirth: 'date of birth', nationalId: 'NIN', portfolioUrl: 'website' };
  const fillPersonal = async (found) => {
    setError('');
    const missing = Object.fromEntries(Object.entries(found).filter(([k]) => !profile?.[k]));
    const kept = Object.keys(found).filter((k) => profile?.[k]).map((k) => LABELS[k]);
    if (!Object.keys(missing).length) { setNotice('Your profile already has these details - nothing changed.'); return; }
    try {
      await client.put('/api/candidates/me', missing);
      setNotice(`Added your ${Object.keys(missing).map((k) => LABELS[k]).join(', ')}.${kept.length ? ` Kept the ${kept.join(', ')} already on your profile.` : ''}`);
      onAdded?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add these details');
    }
  };
  const addGrades = async (grades) => {
    setError('');
    let added = 0;
    for (const g of grades) {
      try { await client.post('/api/candidates/me/exam-grades', g); added += 1; } catch { /* one bad grade doesn't stop the rest */ }
    }
    setNotice(`Added ${added} of ${grades.length} O-Level / A-Level result${grades.length === 1 ? '' : 's'} - check them under O-Level and A-Level results.`);
    onAdded?.();
  };

  return (
    <div>
      <CvAutofillPanel uploadOnly withNationalId={profile?.candidateType !== 'Internal'}
        onPersonalSuggested={fillPersonal} onExamGradesSuggested={addGrades}
        onLinkedinSuggested={(url) => client.put('/api/candidates/me', { linkedinUrl: url })
          .then(() => { setError(''); setNotice('LinkedIn added to your profile.'); onAdded?.(); })
          .catch((err) => setError(err.response?.data?.error || 'Could not add your LinkedIn'))}
        onEducationSuggested={take('education', 'Qualification')}
        onWorkExperienceSuggested={take('workExperience', 'Job')}
        onCertificateSuggested={take('certificates', 'Certificate')} />
      <Alert type="success" message={notice} />
      <Alert type="error" message={error} />
      <ProfileEntriesEditor ref={editor} profile={profile} onSaved={onAdded} />
    </div>
  );
}
