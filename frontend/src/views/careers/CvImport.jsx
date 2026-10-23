import React, { useRef, useState } from 'react';
import client from '../../models/apiClient';
import Alert from '../../components/Alert';
import CvAutofillPanel from '../../components/CvAutofillPanel';
import ProfileEntriesEditor from '../../components/ProfileEntriesEditor';

// "Fill in from your CV" on My profile: the CV is read on the server
// (POST /api/candidates/me/parse-cv, nothing kept) and each suggestion the
// candidate takes becomes an entry in the editor below - filled in, saved
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

  return (
    <div>
      <CvAutofillPanel uploadOnly
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
