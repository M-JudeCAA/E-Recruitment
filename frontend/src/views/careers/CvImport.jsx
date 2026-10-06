import React, { useState } from 'react';
import client from '../../models/apiClient';
import Alert from '../../components/Alert';
import CvAutofillPanel from '../../components/CvAutofillPanel';

// "Fill in from your CV" on My profile: the CV is read on the server
// (POST /api/candidates/me/parse-cv, nothing kept) and each suggestion the
// candidate accepts is added to their profile straight away. The API skips
// an entry the profile already has (entryDedup). Dates read from a CV are
// the least reliable part, so the candidate is asked to check them.
export default function CvImport({ onAdded }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const add = (path, body, what) => async () => {
    setError(''); setNotice('');
    try {
      await client.post(path, body);
      setNotice(`${what} added to your profile.${path.includes('education') ? '' : ' Check its dates there, since a CV’s dates are often read wrongly.'}`);
      onAdded?.();
    } catch (err) {
      setError(err.response?.data?.error || `Could not add this ${what.toLowerCase()}`);
    }
  };
  const day = (v) => (v ? String(v).slice(0, 10) : null);

  return (
    <div>
      <Alert type="success" message={notice} />
      <Alert type="error" message={error} />
      <CvAutofillPanel uploadOnly
        onLinkedinSuggested={(url) => client.put('/api/candidates/me', { linkedinUrl: url })
          .then(() => { setError(''); setNotice('LinkedIn added to your profile.'); onAdded?.(); })
          .catch((err) => setError(err.response?.data?.error || 'Could not add your LinkedIn'))}
        onEducationSuggested={(e) => add('/api/candidates/me/education', {
          institution: e.institution, qualificationLevel: e.qualificationLevel, fieldOfStudy: e.fieldOfStudy,
          yearCompleted: e.yearCompleted ? Number(e.yearCompleted) : null, cgpa: e.cgpa || null
        }, 'Qualification')()}
        onWorkExperienceSuggested={(w) => add('/api/candidates/me/work-experience', {
          employer: w.employer, jobTitle: w.jobTitle, startDate: day(w.startDate), endDate: day(w.endDate), duties: w.duties || []
        }, 'Job')()}
        onCertificateSuggested={(c) => add('/api/candidates/me/certificates', {
          name: c.name, issuingOrganization: c.issuingOrganization, issueDate: day(c.issueDate), expiryDate: day(c.expiryDate)
        }, 'Certificate')()} />
    </div>
  );
}
