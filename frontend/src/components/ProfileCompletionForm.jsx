import { useEffect, useState } from 'react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import TextField from './TextField';
import Select from './Select';
import Button from './Button';
import Alert from './Alert';
import LoadingState from './LoadingState';
import CvAutofillPanel from './CvAutofillPanel';
import PhotoUploadPanel from './PhotoUploadPanel';
import { validateNationalId, NATIONAL_ID_ERROR } from '../utils/validators';
import { isProfileComplete } from '../utils/profileCompleteness';

const emptyEducation = { institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '' };
const emptyExperience = { employer: '', jobTitle: '', startDate: '', endDate: '' };
let stagedKeySeq = 0;
const nextStagedKey = () => `staged-${Date.now()}-${stagedKeySeq++}`;

// The one shared field set behind all three onboarding surfaces: the
// standalone /profile/complete page (New User, first login), the closable
// modal over the dashboard (Old User), and the closable modal over the
// apply wizard (Advert User). Loads and saves its own data so it can be
// dropped into any of those three contexts unchanged.
export default function ProfileCompletionForm({ onComplete }) {
  const { candidate } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ idType: '', nationalId: '', location: '', workAuthorization: '', linkedinUrl: '', portfolioUrl: '' });
  const [internalForm, setInternalForm] = useState({ employeeId: '', department: '', position: '', dateJoined: '', supervisorName: '', supervisorEmail: '' });
  const [newEdu, setNewEdu] = useState(emptyEducation);
  const [newExp, setNewExp] = useState(emptyExperience);
  // Suggestions accepted from CvAutofillPanel land here, one card per
  // entry - NOT in newEdu/newExp above, which only ever hold a single
  // manually-typed draft. Keeping suggestions in their own array is what
  // lets several CV-detected entries be reviewed and added independently
  // instead of each new "Use this" click silently overwriting the last.
  const [stagedEducation, setStagedEducation] = useState([]);
  const [stagedWorkExperience, setStagedWorkExperience] = useState([]);
  // Which already-saved entry (by id) is currently open for editing, if
  // any - null means every saved entry is showing its read-only view.
  const [editingEduId, setEditingEduId] = useState(null);
  const [editEduForm, setEditEduForm] = useState(emptyEducation);
  const [editingExpId, setEditingExpId] = useState(null);
  const [editExpForm, setEditExpForm] = useState(emptyExperience);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // One busy flag per button (keyed by a descriptive string, e.g.
  // `delete-edu-${id}`) so any add/save/delete action shows its own
  // spinner and gets disabled for exactly as long as its own request is
  // in flight, without one entry's request disabling another's button.
  const [busy, setBusy] = useState({});
  const isBusy = (key) => !!busy[key];
  const runBusy = async (key, fn) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const isInternal = candidate?.candidateType === 'Internal';

  const load = () => client.get('/api/candidates/me').then((res) => {
    const data = res.data;
    setProfile(data);
    setForm({
      idType: data.idType || '',
      nationalId: data.nationalId || '',
      location: data.location || '',
      workAuthorization: data.workAuthorization || '',
      linkedinUrl: data.linkedinUrl || '',
      portfolioUrl: data.portfolioUrl || ''
    });
    if (data.internalProfile) {
      const p = data.internalProfile;
      setInternalForm({
        employeeId: p.employeeId || '', department: p.department || '', position: p.position || '',
        dateJoined: p.dateJoined ? p.dateJoined.slice(0, 10) : '',
        supervisorName: p.supervisorName || '', supervisorEmail: p.supervisorEmail || ''
      });
    }
    setLoading(false);
    return data;
  });

  useEffect(() => { load(); }, []);

  const fieldError = (field) => {
    const value = form[field];
    switch (field) {
      case 'idType': return value ? '' : 'Select an ID type.';
      case 'nationalId':
        if (!value) return 'This field is required.';
        if (form.idType === 'NationalID' && !validateNationalId(value)) return NATIONAL_ID_ERROR;
        return '';
      case 'location': return value ? '' : 'This field is required.';
      case 'workAuthorization': return value ? '' : 'This field is required.';
      default: return '';
    }
  };
  const internalFieldError = (field) => (internalForm[field] ? '' : 'This field is required.');

  const showError = (field) => (touched[field] || submitted) ? fieldError(field) : '';
  const showInternalError = (field) => (touched[`internal.${field}`] || submitted) ? internalFieldError(field) : '';
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));
  const blurInternal = (field) => () => setTouched((t) => ({ ...t, [`internal.${field}`]: true }));

  const setField = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setInternalField = (key) => (e) => setInternalForm({ ...internalForm, [key]: e.target.value });

  // Shared by the manual "Add education entry" button, each staged
  // CV-suggestion card's own "Add this entry" button, and editing an
  // already-saved entry - one real POST (new entry) or PUT (edit, when id
  // is given) per call, independent of whatever else is staged or saved.
  const persistEducation = async (entry, id) => {
    try {
      const payload = {
        institution: entry.institution, qualificationLevel: entry.qualificationLevel,
        fieldOfStudy: entry.fieldOfStudy, yearCompleted: entry.yearCompleted ? Number(entry.yearCompleted) : null
      };
      if (id) await client.put(`/api/candidates/me/education/${id}`, payload);
      else await client.post('/api/candidates/me/education', payload);
      await load();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save education entry');
      return false;
    }
  };

  const persistWorkExperience = async (entry, id) => {
    try {
      const payload = { employer: entry.employer, jobTitle: entry.jobTitle, startDate: entry.startDate, endDate: entry.endDate || null };
      if (id) await client.put(`/api/candidates/me/work-experience/${id}`, payload);
      else await client.post('/api/candidates/me/work-experience', payload);
      await load();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save work experience entry');
      return false;
    }
  };

  const addEducation = async () => {
    if (!newEdu.institution || !newEdu.qualificationLevel || !newEdu.fieldOfStudy) {
      setError('Institution, qualification level, and field of study are required to add an education entry.');
      return;
    }
    setError('');
    if (await persistEducation(newEdu)) setNewEdu(emptyEducation);
  };

  const addExperience = async () => {
    if (!newExp.employer || !newExp.jobTitle || !newExp.startDate) {
      setError('Employer, job title, and start date are required to add a work experience entry.');
      return;
    }
    setError('');
    if (await persistWorkExperience(newExp)) setNewExp(emptyExperience);
  };

  const updateStagedEducation = (key, field, value) => setStagedEducation((rows) =>
    rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const updateStagedWorkExperience = (key, field, value) => setStagedWorkExperience((rows) =>
    rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const addStagedEducation = async (row) => {
    if (!row.institution || !row.qualificationLevel || !row.fieldOfStudy) {
      setError('Institution, qualification level, and field of study are required to add this entry.');
      return;
    }
    setError('');
    if (await persistEducation(row)) setStagedEducation((rows) => rows.filter((r) => r.key !== row.key));
  };

  const addStagedWorkExperience = async (row) => {
    if (!row.employer || !row.jobTitle || !row.startDate) {
      setError('Employer, job title, and start date are required to add this entry.');
      return;
    }
    setError('');
    if (await persistWorkExperience(row)) setStagedWorkExperience((rows) => rows.filter((r) => r.key !== row.key));
  };

  const startEditEducation = (edu) => {
    setEditingEduId(edu.id);
    setEditEduForm({
      institution: edu.institution || '', qualificationLevel: edu.qualificationLevel || '',
      fieldOfStudy: edu.fieldOfStudy || '', yearCompleted: edu.yearCompleted ? String(edu.yearCompleted) : ''
    });
  };
  const saveEditEducation = async () => {
    if (!editEduForm.institution || !editEduForm.qualificationLevel || !editEduForm.fieldOfStudy) {
      setError('Institution, qualification level, and field of study are required.');
      return;
    }
    setError('');
    if (await persistEducation(editEduForm, editingEduId)) setEditingEduId(null);
  };
  const deleteEducationEntry = async (id) => {
    if (!window.confirm('Delete this education entry? This cannot be undone.')) return;
    setError('');
    try {
      await client.delete(`/api/candidates/me/education/${id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete education entry');
    }
  };

  const startEditExperience = (w) => {
    setEditingExpId(w.id);
    setEditExpForm({
      employer: w.employer || '', jobTitle: w.jobTitle || '',
      startDate: w.startDate ? w.startDate.slice(0, 10) : '', endDate: w.endDate ? w.endDate.slice(0, 10) : ''
    });
  };
  const saveEditExperience = async () => {
    if (!editExpForm.employer || !editExpForm.jobTitle || !editExpForm.startDate) {
      setError('Employer, job title, and start date are required.');
      return;
    }
    setError('');
    if (await persistWorkExperience(editExpForm, editingExpId)) setEditingExpId(null);
  };
  const deleteExperienceEntry = async (id) => {
    if (!window.confirm('Delete this work experience entry? This cannot be undone.')) return;
    setError('');
    try {
      await client.delete(`/api/candidates/me/work-experience/${id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete work experience entry');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setMessage(''); setError('');

    const candidateFields = ['idType', 'nationalId', 'location', 'workAuthorization'];
    const hasCandidateError = candidateFields.some((f) => fieldError(f));
    const internalFields = ['employeeId', 'department', 'position', 'dateJoined', 'supervisorName', 'supervisorEmail'];
    const hasInternalError = isInternal && internalFields.some((f) => internalFieldError(f));
    if (hasCandidateError || hasInternalError) {
      setError('Please fix the highlighted fields before saving.');
      return;
    }

    setSaving(true);
    try {
      await client.put('/api/candidates/me', form);
      if (isInternal) {
        await client.put('/api/candidates/me/internal-profile', internalForm);
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
        onEducationSuggested={(entry) => setStagedEducation((rows) => [...rows, {
          key: nextStagedKey(), institution: entry.institution || '', qualificationLevel: entry.qualificationLevel || '',
          fieldOfStudy: entry.fieldOfStudy || '', yearCompleted: entry.yearCompleted ? String(entry.yearCompleted) : ''
        }])}
        onWorkExperienceSuggested={(entry) => setStagedWorkExperience((rows) => [...rows, {
          key: nextStagedKey(), employer: entry.employer || '', jobTitle: entry.jobTitle || '',
          startDate: entry.startDate || '', endDate: entry.endDate || ''
        }])}
      />

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Personal details</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <Select label="ID type" required value={form.idType} onChange={setField('idType')} onBlur={blur('idType')} error={showError('idType')}>
          <option value="">Select one</option>
          <option value="NationalID">Uganda National ID</option>
          <option value="Passport">Passport</option>
        </Select>
        <TextField
          label={form.idType === 'Passport' ? 'Passport number' : 'National ID number'}
          required value={form.nationalId} onChange={setField('nationalId')} onBlur={blur('nationalId')}
          error={showError('nationalId')}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Current location" hint="City, country" required
          value={form.location} onChange={setField('location')} onBlur={blur('location')} error={showError('location')} />
        <Select label="Authorized to work in Uganda?" required value={form.workAuthorization}
          onChange={setField('workAuthorization')} onBlur={blur('workAuthorization')} error={showError('workAuthorization')}>
          <option value="">Select one</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Sponsorship">Would need sponsorship</option>
        </Select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="LinkedIn" hint="Optional" placeholder="linkedin.com/in/..."
          value={form.linkedinUrl} onChange={setField('linkedinUrl')} />
        <TextField label="Portfolio or personal website" hint="Optional" placeholder="yoursite.com"
          value={form.portfolioUrl} onChange={setField('portfolioUrl')} />
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 8, marginTop: 24 }}>Education</h3>
      {(profile?.education || []).length === 0 && stagedEducation.length === 0 && (submitted || touched.education) && (
        <p style={{ fontSize: 13, color: 'var(--color-danger)' }}>Add at least one education entry.</p>
      )}
      {(profile?.education || []).map((edu) => editingEduId === edu.id ? (
        <div key={edu.id} style={{ marginTop: 12, marginBottom: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
          <TextField label="Institution" value={editEduForm.institution} onChange={(e) => setEditEduForm({ ...editEduForm, institution: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <Select label="Qualification level" value={editEduForm.qualificationLevel} onChange={(e) => setEditEduForm({ ...editEduForm, qualificationLevel: e.target.value })}>
              <option value="">Select a level</option>
              <option value="Certificate">Certificate</option>
              <option value="Diploma">Diploma</option>
              <option value="Bachelors">Bachelor's</option>
              <option value="Masters">Master's</option>
              <option value="PhD">PhD</option>
            </Select>
            <TextField label="Field of study" value={editEduForm.fieldOfStudy} onChange={(e) => setEditEduForm({ ...editEduForm, fieldOfStudy: e.target.value })} />
          </div>
          <TextField label="Year completed" type="number" hint="Leave blank if still in progress" value={editEduForm.yearCompleted} onChange={(e) => setEditEduForm({ ...editEduForm, yearCompleted: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" loading={isBusy('editEdu')} loadingText="Saving..." onClick={() => runBusy('editEdu', saveEditEducation)}>Save changes</Button>
            <Button type="button" variant="ghost" disabled={isBusy('editEdu')} onClick={() => setEditingEduId(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div key={edu.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span><strong>{edu.qualificationLevel}</strong> in {edu.fieldOfStudy} - {edu.institution} ({edu.yearCompleted || 'in progress'})</span>
          <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <Button type="button" variant="ghost" onClick={() => startEditEducation(edu)}>Edit</Button>
            <Button type="button" variant="ghost" loading={isBusy(`delete-edu-${edu.id}`)} loadingText="Deleting..." onClick={() => runBusy(`delete-edu-${edu.id}`, () => deleteEducationEntry(edu.id))}>Delete</Button>
          </span>
        </div>
      ))}

      {stagedEducation.map((row) => (
        <div key={row.key} style={{ marginTop: 12, padding: 12, border: '1px dashed var(--color-primary)', borderRadius: 'var(--radius-sm)' }}>
          <p style={{ fontSize: 12, color: 'var(--color-primary)', marginTop: 0, marginBottom: 8 }}>From your CV - review and add</p>
          <TextField label="Institution" value={row.institution} onChange={(e) => updateStagedEducation(row.key, 'institution', e.target.value)} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <Select label="Qualification level" value={row.qualificationLevel} onChange={(e) => updateStagedEducation(row.key, 'qualificationLevel', e.target.value)}>
              <option value="">Select a level</option>
              <option value="Certificate">Certificate</option>
              <option value="Diploma">Diploma</option>
              <option value="Bachelors">Bachelor's</option>
              <option value="Masters">Master's</option>
              <option value="PhD">PhD</option>
            </Select>
            <TextField label="Field of study" value={row.fieldOfStudy} onChange={(e) => updateStagedEducation(row.key, 'fieldOfStudy', e.target.value)} />
          </div>
          <TextField label="Year completed" type="number" hint="Leave blank if still in progress" value={row.yearCompleted} onChange={(e) => updateStagedEducation(row.key, 'yearCompleted', e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" loading={isBusy(`staged-edu-${row.key}`)} loadingText="Adding..." onClick={() => runBusy(`staged-edu-${row.key}`, () => addStagedEducation(row))}>Add this entry</Button>
            <Button type="button" variant="ghost" disabled={isBusy(`staged-edu-${row.key}`)} onClick={() => setStagedEducation((rows) => rows.filter((r) => r.key !== row.key))}>Discard</Button>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 12, marginBottom: 24 }}>
        <TextField label="Institution" value={newEdu.institution} onChange={(e) => setNewEdu({ ...newEdu, institution: e.target.value })} onBlur={blur('education')} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
          <Select label="Qualification level" value={newEdu.qualificationLevel} onChange={(e) => setNewEdu({ ...newEdu, qualificationLevel: e.target.value })}>
            <option value="">Select a level</option>
            <option value="Certificate">Certificate</option>
            <option value="Diploma">Diploma</option>
            <option value="Bachelors">Bachelor's</option>
            <option value="Masters">Master's</option>
            <option value="PhD">PhD</option>
          </Select>
          <TextField label="Field of study" value={newEdu.fieldOfStudy} onChange={(e) => setNewEdu({ ...newEdu, fieldOfStudy: e.target.value })} />
        </div>
        <TextField label="Year completed" type="number" hint="Leave blank if still in progress" value={newEdu.yearCompleted} onChange={(e) => setNewEdu({ ...newEdu, yearCompleted: e.target.value })} />
        <Button type="button" variant="ghost" loading={isBusy('addEdu')} loadingText="Adding..." onClick={() => runBusy('addEdu', addEducation)}>Add education entry</Button>
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Work Experience</h3>
      {(profile?.workExperience || []).length === 0 && stagedWorkExperience.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No work experience entries on file yet (optional).</p>
      )}
      {(profile?.workExperience || []).map((w) => editingExpId === w.id ? (
        <div key={w.id} style={{ marginTop: 12, marginBottom: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
          <TextField label="Employer" value={editExpForm.employer} onChange={(e) => setEditExpForm({ ...editExpForm, employer: e.target.value })} />
          <TextField label="Job title" value={editExpForm.jobTitle} onChange={(e) => setEditExpForm({ ...editExpForm, jobTitle: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Start date" type="date" value={editExpForm.startDate} onChange={(e) => setEditExpForm({ ...editExpForm, startDate: e.target.value })} />
            <TextField label="End date" type="date" hint="Leave blank if this is your current role" value={editExpForm.endDate} onChange={(e) => setEditExpForm({ ...editExpForm, endDate: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" loading={isBusy('editExp')} loadingText="Saving..." onClick={() => runBusy('editExp', saveEditExperience)}>Save changes</Button>
            <Button type="button" variant="ghost" disabled={isBusy('editExp')} onClick={() => setEditingExpId(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div key={w.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span><strong>{w.jobTitle}</strong> at {w.employer} ({w.startDate?.slice(0, 10)} - {w.endDate ? w.endDate.slice(0, 10) : 'present'})</span>
          <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <Button type="button" variant="ghost" onClick={() => startEditExperience(w)}>Edit</Button>
            <Button type="button" variant="ghost" loading={isBusy(`delete-exp-${w.id}`)} loadingText="Deleting..." onClick={() => runBusy(`delete-exp-${w.id}`, () => deleteExperienceEntry(w.id))}>Delete</Button>
          </span>
        </div>
      ))}

      {stagedWorkExperience.map((row) => (
        <div key={row.key} style={{ marginTop: 12, padding: 12, border: '1px dashed var(--color-primary)', borderRadius: 'var(--radius-sm)' }}>
          <p style={{ fontSize: 12, color: 'var(--color-primary)', marginTop: 0, marginBottom: 8 }}>From your CV - review and add</p>
          <TextField label="Employer" value={row.employer} onChange={(e) => updateStagedWorkExperience(row.key, 'employer', e.target.value)} />
          <TextField label="Job title" value={row.jobTitle} onChange={(e) => updateStagedWorkExperience(row.key, 'jobTitle', e.target.value)} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Start date" type="date" value={row.startDate} onChange={(e) => updateStagedWorkExperience(row.key, 'startDate', e.target.value)} />
            <TextField label="End date" type="date" hint="Leave blank if this is your current role" value={row.endDate} onChange={(e) => updateStagedWorkExperience(row.key, 'endDate', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" loading={isBusy(`staged-exp-${row.key}`)} loadingText="Adding..." onClick={() => runBusy(`staged-exp-${row.key}`, () => addStagedWorkExperience(row))}>Add this entry</Button>
            <Button type="button" variant="ghost" disabled={isBusy(`staged-exp-${row.key}`)} onClick={() => setStagedWorkExperience((rows) => rows.filter((r) => r.key !== row.key))}>Discard</Button>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 12, marginBottom: 24 }}>
        <TextField label="Employer" value={newExp.employer} onChange={(e) => setNewExp({ ...newExp, employer: e.target.value })} />
        <TextField label="Job title" value={newExp.jobTitle} onChange={(e) => setNewExp({ ...newExp, jobTitle: e.target.value })} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
          <TextField label="Start date" type="date" value={newExp.startDate} onChange={(e) => setNewExp({ ...newExp, startDate: e.target.value })} />
          <TextField label="End date" type="date" hint="Leave blank if this is your current role" value={newExp.endDate} onChange={(e) => setNewExp({ ...newExp, endDate: e.target.value })} />
        </div>
        <Button type="button" variant="ghost" loading={isBusy('addExp')} loadingText="Adding..." onClick={() => runBusy('addExp', addExperience)}>Add work experience entry</Button>
      </div>

      {isInternal && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Internal employment details</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Required for any internal application to proceed past initial review. HR must verify this before shortlisting.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Employee ID" required value={internalForm.employeeId} onChange={setInternalField('employeeId')} onBlur={blurInternal('employeeId')} error={showInternalError('employeeId')} />
            <TextField label="Date joined" type="date" required value={internalForm.dateJoined} onChange={setInternalField('dateJoined')} onBlur={blurInternal('dateJoined')} error={showInternalError('dateJoined')} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Department" required value={internalForm.department} onChange={setInternalField('department')} onBlur={blurInternal('department')} error={showInternalError('department')} />
            <TextField label="Position" required value={internalForm.position} onChange={setInternalField('position')} onBlur={blurInternal('position')} error={showInternalError('position')} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Supervisor name" required value={internalForm.supervisorName} onChange={setInternalField('supervisorName')} onBlur={blurInternal('supervisorName')} error={showInternalError('supervisorName')} />
            <TextField label="Supervisor email" required value={internalForm.supervisorEmail} onChange={setInternalField('supervisorEmail')} onBlur={blurInternal('supervisorEmail')} error={showInternalError('supervisorEmail')} />
          </div>
        </>
      )}

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Button type="submit" loading={saving} loadingText="Saving...">Save profile</Button>
    </form>
  );
}
