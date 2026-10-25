import React, { useRef, useState } from 'react';
import client from '../../models/apiClient';
import Alert from '../../components/Alert';
import CvAutofillPanel from '../../components/CvAutofillPanel';
import ProfileEntriesEditor from '../../components/ProfileEntriesEditor';
import ExamGradesEditor from '../../components/ExamGradesEditor';

// "Fill in from your CV" on My profile: the CV is read on the server
// (POST /api/candidates/me/parse-cv, nothing kept) and everything read goes
// straight onto the profile - each qualification, job and certificate as an
// entry in the editor below (saved like one typed by hand, marked "from your
// CV" so its dates get checked, with Edit and Delete), personal details and
// LinkedIn only where the profile has none, O-Level / A-Level results added
// (shown under Education).
// One the profile already has is skipped; the panel says what went in.
// Used on both sites: the public site's My profile, and Internal Careers'
// My profile and first sign-in setup (Education and experience step).
const LABELS = { location: 'Place of residence', districtOfOrigin: 'District of origin', dateOfBirth: 'Date of birth', nationalId: 'NIN', portfolioUrl: 'Website' };

// entriesRef: the editor, for the Done or Continue around it (finish()).
// links: take LinkedIn and a website from the CV - off on Internal Careers,
// which shows neither (an internal candidate's NIN is never taken either).
export default function CvImport({ profile, onAdded, entriesRef, links = true }) {
  const ownEditor = useRef(null);
  const editor = entriesRef || ownEditor;
  const [error, setError] = useState('');

  // An internal candidate's current UCAA job is already on the profile, from
  // their employment details; their CV's line for it rarely matches word for
  // word, so a current job at UCAA counts as one the profile has.
  const UCAA_JOB = /civil aviation authority|\bucaa\b/i;
  const currentUcaaJob = (w) => UCAA_JOB.test(w.employer || '') && !w.endDate;
  const hasCurrentUcaaJob = profile?.candidateType === 'Internal' && (profile.workExperience || []).some(currentUcaaJob);
  const take = (kind) => (values) => {
    if (kind === 'workExperience' && hasCurrentUcaaJob && currentUcaaJob(values)) return false;
    return editor.current?.addFromCv(kind, values) || false;
  };

  // Personal details fill only what the profile doesn't have yet.
  const fillPersonal = async (found) => {
    const missing = Object.fromEntries(Object.entries(found).filter(([k]) => !profile?.[k] && (links || k !== 'portfolioUrl')));
    if (!Object.keys(missing).length) return [];
    try {
      await client.put('/api/candidates/me', missing);
      onAdded?.();
      return Object.keys(missing).map((k) => LABELS[k]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add your personal details');
      return [];
    }
  };
  const addLinkedin = async (url) => {
    if (profile?.linkedinUrl) return false;
    try {
      await client.put('/api/candidates/me', { linkedinUrl: url });
      onAdded?.();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add your LinkedIn');
      return false;
    }
  };
  // The API answers a result the profile already has with 200, a new one 201.
  const addGrades = async (grades) => {
    let added = 0;
    for (const g of grades) {
      try { if ((await client.post('/api/candidates/me/exam-grades', g)).status === 201) added += 1; } catch { /* one bad grade doesn't stop the rest */ }
    }
    if (added) onAdded?.();
    return added;
  };

  return (
    <div>
      <CvAutofillPanel withNationalId={profile?.candidateType !== 'Internal'}
        onPersonalSuggested={fillPersonal} onExamGradesSuggested={addGrades} onLinkedinSuggested={links ? addLinkedin : undefined}
        onEducationSuggested={take('education')}
        onWorkExperienceSuggested={take('workExperience')}
        onCertificateSuggested={take('certificates')} />
      <Alert type="error" message={error} />
      <ProfileEntriesEditor ref={editor} profile={profile} onSaved={onAdded}
        educationExtra={<ExamGradesEditor examGrades={profile?.examGrades} onChange={() => onAdded?.()} />} />
    </div>
  );
}
