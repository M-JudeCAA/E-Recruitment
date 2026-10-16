import React, { useEffect, useState } from 'react';
import client from '../../models/apiClient';
import { myDirectoryProfile, isEntraConfigured, searchStaffDirectory } from '../../models/entraAuth';
import TextField from '../../components/TextField';
import DirectoryPersonField from '../../components/DirectoryPersonField';
import SuggestField from '../../components/SuggestField';
import Alert from '../../components/Alert';
import { validateNationalId } from '../../utils/validators';

// The short forms the candidate pages ask for - a UCAA employee's employment
// (what HR verifies; Internal Careers only) and personal details - shared by
// the first-time setup (InternalWelcome) and My profile (CareerProfile). Each
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

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export function EmploymentForm({ me, bind, onSaved }) {
  const p = me?.internalProfile || {};
  const [form, setForm] = useState({
    position: p.position || '', department: p.department || '', employeeId: p.employeeId || '',
    departmentId: p.departmentId || null, positionId: p.positionId || null,
    dateJoined: day(p.dateJoined), supervisorName: p.supervisorName || '', supervisorEmail: p.supervisorEmail || ''
  });
  // The department and position are picked from UCAA's organisation
  // structure (GET /api/candidates/me/organisation), never typed in.
  const [org, setOrg] = useState(null);
  const [orgError, setOrgError] = useState('');
  useEffect(() => {
    client.get('/api/candidates/me/organisation')
      .then((res) => setOrg(res.data))
      .catch(() => setOrgError('The list of departments could not be loaded. Refresh the page to try again.'));
  }, []);
  const departmentOptions = (org?.departments || []).map((d) => ({
    id: d.id, label: d.name, detail: [d.code, d.directorate?.name].filter(Boolean).join(' · ')
  }));
  const positionOptions = (org?.positions || []).filter((x) => x.departmentId === form.departmentId)
    .map((x) => ({ id: x.id, label: x.name, detail: x.code || undefined }));
  // What the UCAA directory said, matched to the lists when the names agree.
  useEffect(() => {
    if (!org || form.departmentId) return;
    const dept = org.departments.find((d) => same(d.name, form.department) || same(d.code, form.department));
    if (!dept) return;
    const post = org.positions.find((x) => x.departmentId === dept.id && same(x.name, form.position));
    setForm((f) => ({ ...f, departmentId: dept.id, department: dept.name, ...(post ? { positionId: post.id, position: post.name } : {}) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, form.department]);
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
    !form.departmentId && 'Department, picked from the list', !form.positionId && 'Current position, picked from the list',
    !form.employeeId && 'Employee ID',
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
        <SuggestField label="Department" required value={form.department} picked={Boolean(form.departmentId)}
          options={departmentOptions} placeholder={org ? 'Start typing your department' : 'Loading departments...'} disabled={!org}
          onType={(text) => setForm((f) => ({ ...f, department: text, departmentId: null, position: '', positionId: null }))}
          onPick={(o) => setForm((f) => ({ ...f, department: o.label, departmentId: o.id, ...(o.id === f.departmentId ? {} : { position: '', positionId: null }) }))}
          emptyMessage="No UCAA department matches that - check the spelling, or ask HR to add it."
          error={orgError || undefined}
          hint={form.departmentId ? (hint('department') || undefined) : form.department ? 'Pick your department from the list.' : 'Start typing, then pick it from the list'} />
        <SuggestField label="Current position" required value={form.position} picked={Boolean(form.positionId)}
          options={positionOptions} disabled={!form.departmentId}
          placeholder={form.departmentId ? 'Start typing your position' : 'Pick your department first'}
          onType={(text) => setForm((f) => ({ ...f, position: text, positionId: null }))}
          onPick={(o) => setForm((f) => ({ ...f, position: o.label, positionId: o.id }))}
          emptyMessage="No position in this department matches that - check the department, or ask HR to add the position."
          hint={form.positionId ? (hint('position') || undefined) : form.position && form.departmentId ? 'Pick your position from the list.' : undefined} />
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

// links: also LinkedIn and a portfolio (the public site's applicants).
export function PersonalForm({ me, bind, onSaved, links = false }) {
  const [form, setForm] = useState({
    nationalId: me?.nationalId || '', districtOfOrigin: me?.districtOfOrigin || '', location: me?.location || '',
    dateOfBirth: day(me?.dateOfBirth), flyingHours: me?.flyingHours ?? '',
    ...(links ? { linkedinUrl: me?.linkedinUrl || '', portfolioUrl: me?.portfolioUrl || '' } : {})
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
        <TextField label="Flying hours" type="number" min="0" value={form.flyingHours} onChange={set('flyingHours')} hint="Only for flight crew roles" />
        {links && <TextField label="LinkedIn" value={form.linkedinUrl} onChange={set('linkedinUrl')} placeholder="linkedin.com/in/..." hint="Optional" />}
        {links && <TextField label="Portfolio or personal website" value={form.portfolioUrl} onChange={set('portfolioUrl')} hint="Optional" />}
      </div>
      <Alert type="error" message={error} />
    </div>
  );
}
