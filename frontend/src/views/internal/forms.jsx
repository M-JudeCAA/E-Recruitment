import React, { useEffect, useState } from 'react';
import client from '../../models/apiClient';
import { myDirectoryProfile, isEntraConfigured, searchStaffDirectory } from '../../models/entraAuth';
import TextField from '../../components/TextField';
import DirectoryPersonField from '../../components/DirectoryPersonField';
import Alert from '../../components/Alert';
import { validateNationalId } from '../../utils/validators';

// The two short forms Internal Careers asks for - the employee's UCAA
// employment (what HR verifies) and their personal details - shared by the
// first-time setup (InternalWelcome) and My profile (InternalProfile). Each
// owns its state and exposes save() through the `bind` callback, so the page
// around it decides where the Save button sits.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const day = (v) => (v ? String(v).slice(0, 10) : '');

// UCAA staff matching a name or email, for picking a supervisor: Graph in the
// browser with the employee's own Microsoft session, else the API's directory
// connection. Rejects with `unavailable` when neither can search.
async function searchColleagues(q, ownEmail) {
  let people = null;
  if (isEntraConfigured('candidate')) {
    try { people = await searchStaffDirectory(q, 'candidate'); } catch { /* try the API */ }
  }
  if (!people) {
    try {
      people = (await client.get('/api/candidates/me/directory/people', { params: { q } })).data;
    } catch (err) {
      const code = err.response?.data?.code;
      throw Object.assign(new Error(err.response?.data?.error || 'The UCAA directory could not be searched'),
        { unavailable: code === 'DIRECTORY_NOT_CONFIGURED' });
    }
  }
  const own = String(ownEmail || '').toLowerCase();
  return people.filter((p) => p.email !== own);
}

export function EmploymentForm({ me, bind, onSaved }) {
  const p = me?.internalProfile || {};
  const [form, setForm] = useState({
    position: p.position || '', department: p.department || '', employeeId: p.employeeId || '',
    dateJoined: day(p.dateJoined), supervisorName: p.supervisorName || '', supervisorEmail: p.supervisorEmail || ''
  });
  const [fromDirectory, setFromDirectory] = useState({});
  // The supervisor is picked from the UCAA directory - name and email together.
  // One already on file counts as picked; typing a new name un-picks it. If the
  // directory can't be searched here, both are typed in.
  const [supervisorPicked, setSupervisorPicked] = useState(Boolean(p.supervisorEmail));
  const [directoryDown, setDirectoryDown] = useState(false);
  const [error, setError] = useState('');

  // First time only: fill what the UCAA directory knows, for the person to check.
  useEffect(() => {
    if (p.position || p.employeeId) return undefined;
    let cancelled = false;
    myDirectoryProfile().then((d) => {
      if (cancelled) return;
      const filled = {
        position: d.jobTitle, department: d.department, employeeId: d.employeeId,
        supervisorName: d.managerName, supervisorEmail: d.managerEmail
      };
      setFromDirectory(Object.fromEntries(Object.entries(filled).filter(([, v]) => v)));
      setForm((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || filled[k] || ''])));
      if (d.managerEmail) setSupervisorPicked(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const missing = [
    !form.position && 'Current position', !form.department && 'Department', !form.employeeId && 'Employee ID',
    !form.dateJoined && 'Date joined UCAA', !form.supervisorName && 'Supervisor',
    form.supervisorName && !directoryDown && !supervisorPicked && 'Your supervisor, picked from the suggestions',
    (directoryDown || supervisorPicked) && !EMAIL_RE.test(form.supervisorEmail) && 'Supervisor’s email'
  ].filter(Boolean);

  const save = async () => {
    setError('');
    if (missing.length) { setError(`Still needed: ${missing.join(', ')}.`); return false; }
    try {
      await client.put('/api/candidates/me/internal-profile', form);
      onSaved?.();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your employment details');
      return false;
    }
  };
  useEffect(() => { bind?.(save); });

  const hint = (k) => (fromDirectory[k] ? 'From the UCAA directory. Correct it if it is out of date.' : undefined);
  return (
    <div>
      <div className="ws-form-grid">
        <TextField label="Full name" value={me?.fullName || ''} disabled hint="From your Microsoft account" />
        <TextField label="Work email" value={me?.email || ''} disabled hint="From your Microsoft account" />
        <TextField label="Current position" required value={form.position} onChange={set('position')} hint={hint('position')} />
        <TextField label="Department" required value={form.department} onChange={set('department')} hint={hint('department')} />
        <TextField label="Employee ID" required value={form.employeeId} onChange={set('employeeId')} hint={hint('employeeId')} />
        <TextField label="Date joined UCAA" type="date" required value={form.dateJoined} onChange={set('dateJoined')} />
        <DirectoryPersonField label="Supervisor" required value={form.supervisorName}
          picked={supervisorPicked} unavailable={directoryDown}
          search={(q) => searchColleagues(q, me?.email)}
          onType={(name) => { setSupervisorPicked(false); setForm((f) => ({ ...f, supervisorName: name, supervisorEmail: directoryDown ? f.supervisorEmail : '' })); }}
          onPick={(person) => { setSupervisorPicked(true); setForm((f) => ({ ...f, supervisorName: person.name, supervisorEmail: person.email })); }}
          onUnavailable={() => setDirectoryDown(true)}
          hint={directoryDown ? 'Type their full name.' : supervisorPicked ? (hint('supervisorName') || 'From the UCAA directory') : 'Start typing, then pick them from the list'} />
        <TextField label="Supervisor’s email" type="email" required value={form.supervisorEmail}
          onChange={set('supervisorEmail')} disabled={!directoryDown}
          placeholder={directoryDown ? 'name@caa.co.ug' : 'Filled in when you pick your supervisor'}
          hint={directoryDown ? 'The UCAA directory can’t be searched here yet, so type their UCAA email.' : supervisorPicked ? 'From the UCAA directory' : undefined} />
      </div>
      <Alert type="error" message={error} />
    </div>
  );
}

export function PersonalForm({ me, bind, onSaved }) {
  const [form, setForm] = useState({
    nationalId: me?.nationalId || '', districtOfOrigin: me?.districtOfOrigin || '', location: me?.location || '',
    dateOfBirth: day(me?.dateOfBirth)
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const missing = [
    !validateNationalId(form.nationalId) && 'A valid National ID number (NIN)',
    !form.districtOfOrigin.trim() && 'District of origin', !form.location.trim() && 'Place of residence'
  ].filter(Boolean);

  const save = async () => {
    setError('');
    if (missing.length) { setError(`Still needed: ${missing.join(', ')}.`); return false; }
    try {
      await client.put('/api/candidates/me', form);
      onSaved?.();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your details');
      return false;
    }
  };
  useEffect(() => { bind?.(save); });

  return (
    <div>
      <div className="ws-form-grid">
        <TextField label="National ID number (NIN)" required maxLength={14} value={form.nationalId} onChange={set('nationalId')} hint="As it appears on your National ID card" />
        <TextField label="District of origin" required maxLength={100} value={form.districtOfOrigin} onChange={set('districtOfOrigin')} hint="The Ugandan district you come from" />
        <TextField label="Place of residence" required value={form.location} onChange={set('location')} hint="Town or district" />
        <TextField label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} hint="Only needed when a vacancy has an age limit" />
      </div>
      <Alert type="error" message={error} />
    </div>
  );
}
