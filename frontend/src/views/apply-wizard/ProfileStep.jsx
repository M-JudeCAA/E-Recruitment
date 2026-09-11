import { useState } from 'react';
import { Plus } from 'lucide-react';
import TextField from '../../components/TextField';
import Select from '../../components/Select';
import Button from '../../components/Button';
import client from '../../models/apiClient';

// No candidate-facing UI for these existed before this. The backend
// (/api/candidates/me/education, /me/work-experience) was already there;
// only the frontend was missing. Entries are candidate-level, not
// application-level - they persist across every application this
// candidate ever submits.
export default function ProfileStep({ profile, onProfileChange, profileDetails, setProfileDetail }) {
  const [newEdu, setNewEdu] = useState({ institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '' });
  const [newExp, setNewExp] = useState({ employer: '', jobTitle: '', startDate: '', endDate: '' });
  const [editingEduId, setEditingEduId] = useState(null);
  const [editEduForm, setEditEduForm] = useState({ institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '' });
  const [editingExpId, setEditingExpId] = useState(null);
  const [editExpForm, setEditExpForm] = useState({ employer: '', jobTitle: '', startDate: '', endDate: '' });
  const [error, setError] = useState('');
  // One busy flag per button, keyed by a descriptive string (e.g.
  // `delete-edu-${id}`) - see ProfileCompletionForm.jsx, which uses the
  // same pattern for the same reason: each add/save/delete action needs
  // its own spinner without disabling every other button on the step.
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

  const addEducation = async () => {
    if (!newEdu.institution || !newEdu.qualificationLevel || !newEdu.fieldOfStudy) {
      setError('Institution, qualification level, and field of study are required');
      return;
    }
    setError('');
    try {
      await client.post('/api/candidates/me/education', {
        ...newEdu, yearCompleted: newEdu.yearCompleted ? Number(newEdu.yearCompleted) : null
      });
      setNewEdu({ institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '' });
      onProfileChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add education entry');
    }
  };

  const addExperience = async () => {
    if (!newExp.employer || !newExp.jobTitle || !newExp.startDate) {
      setError('Employer, job title, and start date are required');
      return;
    }
    setError('');
    try {
      await client.post('/api/candidates/me/work-experience', newExp);
      setNewExp({ employer: '', jobTitle: '', startDate: '', endDate: '' });
      onProfileChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add work experience entry');
    }
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
      setError('Institution, qualification level, and field of study are required');
      return;
    }
    setError('');
    try {
      await client.put(`/api/candidates/me/education/${editingEduId}`, {
        ...editEduForm, yearCompleted: editEduForm.yearCompleted ? Number(editEduForm.yearCompleted) : null
      });
      setEditingEduId(null);
      onProfileChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update education entry');
    }
  };
  const deleteEducationEntry = async (id) => {
    if (!window.confirm('Delete this education entry? This cannot be undone.')) return;
    setError('');
    try {
      await client.delete(`/api/candidates/me/education/${id}`);
      onProfileChange();
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
      setError('Employer, job title, and start date are required');
      return;
    }
    setError('');
    try {
      await client.put(`/api/candidates/me/work-experience/${editingExpId}`, editExpForm);
      setEditingExpId(null);
      onProfileChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update work experience entry');
    }
  };
  const deleteExperienceEntry = async (id) => {
    if (!window.confirm('Delete this work experience entry? This cannot be undone.')) return;
    setError('');
    try {
      await client.delete(`/api/candidates/me/work-experience/${id}`);
      onProfileChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete work experience entry');
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Personal details</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Name, email, and phone come from your account. The rest is used for this and future applications.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Full name" value={profile?.fullName || ''} disabled />
        <TextField label="Email" value={profile?.email || ''} disabled />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Phone" value={profile?.phone || ''} disabled />
        <TextField label="Current location" hint="City, country" value={profileDetails.location} onChange={setProfileDetail('location')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="National Identification Number (NIN)" hint="As it appears on your National ID"
          value={profileDetails.nationalId} onChange={setProfileDetail('nationalId')} />
        <Select label="Authorized to work in Uganda?" value={profileDetails.workAuthorization} onChange={setProfileDetail('workAuthorization')}>
          <option value="">Select one</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Sponsorship">Would need sponsorship</option>
        </Select>
      </div>
      <TextField label="LinkedIn or personal site" hint="Optional" placeholder="linkedin.com/in/..."
        value={profileDetails.linkedinUrl} onChange={setProfileDetail('linkedinUrl')} />

      <h3 style={{ fontSize: 15, marginBottom: 8, marginTop: 24 }}>Education</h3>
      {(profile?.education || []).length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No education entries on file yet.</p>
      )}
      {(profile?.education || []).map((e) => editingEduId === e.id ? (
        <div key={e.id} style={{ marginTop: 12, marginBottom: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
          <TextField label="Institution" value={editEduForm.institution} onChange={(ev) => setEditEduForm({ ...editEduForm, institution: ev.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <Select label="Qualification level" value={editEduForm.qualificationLevel} onChange={(ev) => setEditEduForm({ ...editEduForm, qualificationLevel: ev.target.value })}>
              <option value="">Select a level</option>
              <option value="Certificate">Certificate</option>
              <option value="Diploma">Diploma</option>
              <option value="Bachelors">Bachelor's</option>
              <option value="Masters">Master's</option>
              <option value="PhD">PhD</option>
            </Select>
            <TextField label="Field of study" value={editEduForm.fieldOfStudy} onChange={(ev) => setEditEduForm({ ...editEduForm, fieldOfStudy: ev.target.value })} />
          </div>
          <TextField label="Year completed" type="number" hint="Leave blank if still in progress" value={editEduForm.yearCompleted} onChange={(ev) => setEditEduForm({ ...editEduForm, yearCompleted: ev.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" loading={isBusy('editEdu')} loadingText="Saving..." onClick={() => runBusy('editEdu', saveEditEducation)}>Save changes</Button>
            <Button type="button" variant="ghost" disabled={isBusy('editEdu')} onClick={() => setEditingEduId(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div key={e.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span><strong>{e.qualificationLevel}</strong> in {e.fieldOfStudy} - {e.institution} ({e.yearCompleted || 'in progress'})</span>
          <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <Button type="button" variant="ghost" onClick={() => startEditEducation(e)}>Edit</Button>
            <Button type="button" variant="ghost" loading={isBusy(`delete-edu-${e.id}`)} loadingText="Deleting..." onClick={() => runBusy(`delete-edu-${e.id}`, () => deleteEducationEntry(e.id))}>Delete</Button>
          </span>
        </div>
      ))}
      <div style={{ marginTop: 12, marginBottom: 24 }}>
        <TextField label="Institution" value={newEdu.institution} onChange={(e) => setNewEdu({ ...newEdu, institution: e.target.value })} />
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
        <Button type="button" variant="ghost" loading={isBusy('addEdu')} loadingText="Adding..." onClick={() => runBusy('addEdu', addEducation)}><Plus size={14} /> Add education entry</Button>
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Work Experience</h3>
      {(profile?.workExperience || []).length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No work experience entries on file yet.</p>
      )}
      {(profile?.workExperience || []).map((w) => editingExpId === w.id ? (
        <div key={w.id} style={{ marginTop: 12, marginBottom: 12, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
          <TextField label="Employer" value={editExpForm.employer} onChange={(ev) => setEditExpForm({ ...editExpForm, employer: ev.target.value })} />
          <TextField label="Job title" value={editExpForm.jobTitle} onChange={(ev) => setEditExpForm({ ...editExpForm, jobTitle: ev.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Start date" type="date" value={editExpForm.startDate} onChange={(ev) => setEditExpForm({ ...editExpForm, startDate: ev.target.value })} />
            <TextField label="End date" type="date" hint="Leave blank if this is your current role" value={editExpForm.endDate} onChange={(ev) => setEditExpForm({ ...editExpForm, endDate: ev.target.value })} />
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
      <div style={{ marginTop: 12 }}>
        <TextField label="Employer" value={newExp.employer} onChange={(e) => setNewExp({ ...newExp, employer: e.target.value })} />
        <TextField label="Job title" value={newExp.jobTitle} onChange={(e) => setNewExp({ ...newExp, jobTitle: e.target.value })} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
          <TextField label="Start date" type="date" value={newExp.startDate} onChange={(e) => setNewExp({ ...newExp, startDate: e.target.value })} />
          <TextField label="End date" type="date" hint="Leave blank if this is your current role" value={newExp.endDate} onChange={(e) => setNewExp({ ...newExp, endDate: e.target.value })} />
        </div>
        <Button type="button" variant="ghost" loading={isBusy('addExp')} loadingText="Adding..." onClick={() => runBusy('addExp', addExperience)}><Plus size={14} /> Add work experience entry</Button>
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 12 }}>{error}</p>}
    </div>
  );
}
