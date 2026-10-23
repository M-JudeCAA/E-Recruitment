import { useEffect, useRef, useState } from 'react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import TextField from './TextField';
import Button from './Button';
import Alert from './Alert';
import LoadingState from './LoadingState';
import CvAutofillPanel from './CvAutofillPanel';
import PhotoUploadPanel from './PhotoUploadPanel';
import ExamGradesEditor from './ExamGradesEditor';
import { EmploymentForm } from '../views/careers/forms';
import { validateNationalId, NATIONAL_ID_ERROR } from '../utils/validators';
import { isProfileComplete } from '../utils/profileCompleteness';
import ProfileEntriesEditor from './ProfileEntriesEditor';

// The one shared field set behind all three onboarding surfaces: the
// standalone /profile/complete page (New User, first login), the closable
// modal over the dashboard (Old User), and the closable modal over the
// apply wizard (Advert User). Loads and saves its own data so it can be
// dropped into any of those three contexts unchanged.
export default function ProfileCompletionForm({ onComplete }) {
  const { candidate } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    nationalId: '', location: '', districtOfOrigin: '', linkedinUrl: '', portfolioUrl: '',
    dateOfBirth: '', flyingHours: ''
  });
  // An internal candidate's employment: the same form as Internal Careers
  // (department and position picked from the organisation structure).
  const saveEmployment = useRef(null);
  // Education, work experience and certificates: edited in place and saved
  // as they are filled in; CV suggestions become entries there too.
  const entries = useRef(null);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dedupeNotice, setDedupeNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const isInternal = candidate?.candidateType === 'Internal';

  // After an education, work or certificate entry is saved or removed:
  // refresh the profile only. load() would also refill the personal
  // details from the server and wipe anything typed there but not yet saved.
  const refreshEntries = () => client.get('/api/candidates/me').then((res) => {
    setProfile(res.data);
    return res.data;
  });

  const load = () => client.get('/api/candidates/me').then((res) => {
    const data = res.data;
    setProfile(data);
    setForm({
      nationalId: data.nationalId || '',
      location: data.location || '',
      districtOfOrigin: data.districtOfOrigin || '',
      linkedinUrl: data.linkedinUrl || '',
      portfolioUrl: data.portfolioUrl || '',
      dateOfBirth: data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : '',
      flyingHours: data.flyingHours ?? ''
    });
    setLoading(false);
    return data;
  });

  useEffect(() => { load(); }, []);

  const fieldError = (field) => {
    const value = form[field];
    switch (field) {
      case 'nationalId':
        if (!value) return 'This field is required.';
        if (!validateNationalId(value)) return NATIONAL_ID_ERROR;
        return '';
      case 'location': return value ? '' : 'This field is required.';
      case 'districtOfOrigin': return value ? '' : 'This field is required.';
      default: return '';
    }
  };

  const showError = (field) => (touched[field] || submitted) ? fieldError(field) : '';
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  const setField = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  // A CV suggestion becomes an entry below; one the profile already has is skipped.
  const fromCv = (kind, what) => (values) => {
    setDedupeNotice(entries.current?.addFromCv(kind, values) ? '' : `That ${what} is already on your profile - skipped.`);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setMessage(''); setError('');

    // UCAA employees are identified by their employee number, not the NIN.
    const candidateFields = [...(isInternal ? [] : ['nationalId']), 'location', 'districtOfOrigin'];
    const hasCandidateError = candidateFields.some((f) => fieldError(f));
    if (hasCandidateError) {
      setError('Please fix the highlighted fields before saving.');
      return;
    }

    setSaving(true);
    try {
      await entries.current?.flush();
      await client.put('/api/candidates/me', form);
      if (isInternal && !(await saveEmployment.current?.())) {
        setError('Check your employment details below.');
        return;
      }
      const fresh = await load();
      if (isProfileComplete(fresh)) {
        setMessage('Profile saved and complete.');
        onComplete && onComplete(fresh);
      } else {
        setMessage('Saved. A few required details are still missing.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading your profile..." />;

  return (
    <form onSubmit={handleSave}>
      <PhotoUploadPanel
        photoUrl={profile?.photoUrl}
        onChange={(photoUrl) => setProfile((p) => (p ? { ...p, photoUrl } : p))}
      />

      <CvAutofillPanel
        onLinkedinSuggested={(url) => setForm((f) => ({ ...f, linkedinUrl: url }))}
        onEducationSuggested={fromCv('education', 'education entry')}
        onWorkExperienceSuggested={fromCv('workExperience', 'work experience entry')}
        onCertificateSuggested={fromCv('certificates', 'certificate')}
      />
      <Alert type="info" message={dedupeNotice} />

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Personal details</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        {/* The NIN is the only identity document accepted - no passports. */}
        {!isInternal && <TextField
          label="National Identification Number (NIN)" hint="As it appears on your National ID card"
          required maxLength={14} value={form.nationalId} onChange={setField('nationalId')} onBlur={blur('nationalId')}
          error={showError('nationalId')}
        />}
        <TextField label="District of origin" hint="The Ugandan district you come from" required maxLength={100}
          value={form.districtOfOrigin} onChange={setField('districtOfOrigin')} onBlur={blur('districtOfOrigin')}
          error={showError('districtOfOrigin')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Place of residence" hint="Town or district, country" required
          value={form.location} onChange={setField('location')} onBlur={blur('location')} error={showError('location')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="LinkedIn" hint="Optional" placeholder="linkedin.com/in/..."
          value={form.linkedinUrl} onChange={setField('linkedinUrl')} />
        <TextField label="Portfolio or personal website" hint="Optional" placeholder="yoursite.com"
          value={form.portfolioUrl} onChange={setField('portfolioUrl')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Date of birth" type="date" hint="Optional - only needed if a role sets an age requirement"
          value={form.dateOfBirth} onChange={setField('dateOfBirth')} />
        <TextField label="Total flying hours" type="number" min="0" hint="Optional - only relevant to flight-crew roles"
          value={form.flyingHours} onChange={setField('flyingHours')} />
      </div>

      <div style={{ marginTop: 24 }}>
        <ProfileEntriesEditor ref={entries} profile={profile} onSaved={refreshEntries} showMissing={submitted} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <ExamGradesEditor examGrades={profile?.examGrades} onChange={refreshEntries} />
      </div>

      {isInternal && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Internal employment details</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            HR verifies these details before you can submit an application for an internal vacancy.
          </p>
          <EmploymentForm me={profile} bind={(fn) => { saveEmployment.current = fn; }} />
        </>
      )}

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Button type="submit" loading={saving} loadingText="Saving...">Save profile</Button>
    </form>
  );
}
