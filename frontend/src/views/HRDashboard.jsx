import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, CheckCircle2, Clock, FileStack, Plus, Calendar, Building2 } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import StatTile from '../components/StatTile';
import SectionHeading from '../components/SectionHeading';
import TextField from '../components/TextField';
import RichTextField from '../components/RichTextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

const emptyForm = {
  departmentId: '', positionId: '', reportsToPositionId: '',
  positionsRequired: 1, postingType: '', deadline: '', // postingType is now required with no default, so this starts blank to force an explicit choice
  salaryScale: '', description: '',
  minimumExperienceYears: '', minimumEducationLevel: '', preferredFieldOfStudy: ''
};

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK. "Close a
// vacancy" remains Principal HR Officer+, unchanged - the vacancy
// approval simplification was scoped narrowly to approval itself.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function HRDashboard() {
  const { staff } = useAuth();
  // CHANGED - was Principal_HR_Officer. The vacancy workflow simplified
  // from 5-tier (create -> Senior HR Officer review -> Principal HR
  // Officer approve) to 2-tier: HR Officer creates, Manager or Director
  // approves directly - matching "MHRA or DHRA" exactly. The review step
  // is removed, not just hidden - there is no review stage in the new
  // flow at all.
  const canApprove = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager;
  const canTransition = canApprove; // same tier - their call to it IS the required approval

  const [vacancies, setVacancies] = useState([]);
  const [approvedDepartments, setApprovedDepartments] = useState([]);
  const [departmentPositions, setDepartmentPositions] = useState([]);
  const [reportsToOptions, setReportsToOptions] = useState([]);

  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false); // double-submission lock
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});

  const load = () => staffClient.get('/api/vacancies/admin').then((res) => setVacancies(res.data));
  useEffect(() => {
    load();
    staffClient.get('/api/departments/approved')
      .then((res) => setApprovedDepartments(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load departments'));
  }, []);

  function groupDepartmentsByDirectorate(departments) {
    const groups = {};
    departments.forEach((dept) => {
      const key = dept.directorate.name;
      if (!groups[key]) groups[key] = [];
      groups[key].push(dept);
    });
    return groups;
  }

  // Step 1: Department chosen first - loads a short, scoped Position list.
  const handleDepartmentChange = async (departmentId) => {
    setForm({ ...form, departmentId, positionId: '', reportsToPositionId: '' });
    setReportsToOptions([]);
    if (!departmentId) { setDepartmentPositions([]); return; }
    const res = await staffClient.get(`/api/departments/${departmentId}/positions`);
    setDepartmentPositions(res.data);
  };

  // Step 2: Position (Title) chosen - loads senior positions for Reports To.
  const handlePositionChange = async (positionId) => {
    setForm({ ...form, positionId, reportsToPositionId: '' });
    if (!positionId) { setReportsToOptions([]); return; }
    const res = await staffClient.get(`/api/positions/${positionId}/senior-options`);
    setReportsToOptions(res.data);
  };

  const createVacancy = async (e) => {
    e.preventDefault();
    if (creating) return; // a double-click or slow-network retry must not create two vacancies
    setMessage(''); setError(''); setCreating(true);
    try {
      const res = await staffClient.post('/api/vacancies', form);
      setMessage(`Vacancy created (Ref: ${res.data.jobRef}). It needs Manager or Director approval to open.`);
      setForm(emptyForm);
      setDepartmentPositions([]);
      setReportsToOptions([]);
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Failed to create vacancy'));
    } finally {
      setCreating(false);
    }
  };

  const approve = async (id) => {
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/approve`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  };

  const transitionPostingType = async (id, target) => {
    if (!window.confirm(`Transition this vacancy to ${target}? This is audited and cannot be undone directly - you would need a second transition back.`)) return;
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/transition-posting-type`, { postingType: target });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Transition failed');
    }
  };

  const closeVacancy = async (id) => {
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/close`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not close vacancy');
    }
  };

  // Only the fields that remain editable post-creation - positionId,
  // departmentId, and reportsToPositionId are fixed at creation time.
  const openEdit = (v) => {
    setError('');
    setEditForm({
      positionsRequired: v.positionsRequired, postingType: v.postingType,
      deadline: v.deadline ? v.deadline.slice(0, 10) : '',
      salaryScale: v.salaryScale || '', description: v.description || '',
      minimumExperienceYears: v.minimumExperienceYears ?? '',
      minimumEducationLevel: v.minimumEducationLevel || '',
      preferredFieldOfStudy: v.preferredFieldOfStudy || ''
    });
    setEditModal(v);
  };

  const saveEdit = async () => {
    try {
      await staffClient.patch(`/api/vacancies/${editModal.id}`, editForm);
      setEditModal(null);
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Could not save changes'));
    }
  };

  const openCount = vacancies.filter((v) => v.status === 'Open' || v.status === 'PartiallyFilled').length;
  const pendingCount = vacancies.filter((v) => v.status === 'PendingApproval').length;
  const applicationCount = vacancies.reduce((sum, v) => sum + (v._count?.applications ?? 0), 0);

  return (
    <div>
      <PageHeader
        eyebrow="HR"
        title="HR dashboard"
        subtitle={`Logged in as ${staff?.name} (${staff?.role?.replace(/_/g, ' ')})`}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <StatTile icon={Briefcase} label="Total vacancies" value={vacancies.length} />
        <StatTile icon={CheckCircle2} label="Open" value={openCount} color="var(--color-accent)" tint="var(--color-accent-tint)" />
        <StatTile icon={Clock} label="Pending approval" value={pendingCount} color="var(--color-warning)" tint="var(--color-warning-tint)" />
        <StatTile icon={FileStack} label="Applications received" value={applicationCount} />
      </div>

      <Card>
        <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>Create vacancy</h3>
        <form onSubmit={createVacancy}>
          {/* Step 1: Department first, grouped by Directorate - true
              single-level grouping, since each Department row belongs to
              exactly one Directorate. Disambiguates cases like "CWG",
              which exists under five different directorates at UCAA. */}
          <label style={{ display: 'block', marginBottom: 'var(--spacing-md)' }}>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>Department</span>
            <select value={form.departmentId} onChange={(e) => handleDepartmentChange(e.target.value)} required
              style={{ display: 'block', width: '100%', padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
              <option value="">Select a department</option>
              {Object.entries(groupDepartmentsByDirectorate(approvedDepartments)).map(([directorateName, depts]) => (
                <optgroup key={directorateName} label={directorateName}>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

          {/* Step 2: Title (Position) - short, scoped to the chosen department */}
          <Select label="Title" value={form.positionId} onChange={(e) => handlePositionChange(e.target.value)}
            disabled={!form.departmentId} required>
            <option value="">{form.departmentId ? 'Select a position' : 'Select a department first'}</option>
            {departmentPositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {form.departmentId && departmentPositions.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              No positions exist yet for this department. <Link to="/hr/departments">Add one from the Departments screen.</Link>
            </p>
          )}

          {/* Step 3: Reports To - senior positions in that exact department */}
          <Select label="Reports to" value={form.reportsToPositionId}
            onChange={(e) => setForm({ ...form, reportsToPositionId: e.target.value })}
            disabled={!form.positionId}>
            <option value="">{form.positionId ? 'Select a position (optional)' : 'Select a title first'}</option>
            {reportsToOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {form.positionId && reportsToOptions.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              No position senior to this one exists yet in this department.
            </p>
          )}

          <TextField label="Positions required" type="number" min="1" value={form.positionsRequired}
            onChange={(e) => setForm({ ...form, positionsRequired: Number(e.target.value) })} />
          <Select label="Posting type" value={form.postingType} onChange={(e) => setForm({ ...form, postingType: e.target.value })} required>
            <option value="">Select one</option>
            {/* "Open (internal + external)" REMOVED - a vacancy is now
                always exactly one or the other; there is no longer a
                "both" option, and this choice is required. */}
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <TextField label="Deadline" type="date" value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          <TextField label="Salary level / scale" placeholder="e.g. Scale 5" value={form.salaryScale}
            onChange={(e) => setForm({ ...form, salaryScale: e.target.value })} />
          <RichTextField
            label="Job description"
            placeholder="Paste a formatted job description, or type one directly"
            value={form.description}
            onChange={(html) => setForm({ ...form, description: html })}
          />
          <TextField label="Minimum experience (years, optional)" type="number" min="0"
            value={form.minimumExperienceYears}
            onChange={(e) => setForm({ ...form, minimumExperienceYears: e.target.value })} />
          <Select label="Minimum education level (optional)" value={form.minimumEducationLevel}
            onChange={(e) => setForm({ ...form, minimumEducationLevel: e.target.value })}>
            <option value="">No minimum</option>
            <option value="Certificate">Certificate</option>
            <option value="Diploma">Diploma</option>
            <option value="Bachelors">Bachelor's</option>
            <option value="Masters">Master's</option>
            <option value="PhD">PhD</option>
          </Select>
          <TextField label="Preferred field of study (optional, informational only)"
            placeholder="e.g. Aviation Management or related field"
            value={form.preferredFieldOfStudy}
            onChange={(e) => setForm({ ...form, preferredFieldOfStudy: e.target.value })} />
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            This is shown to HR as a note only - it is never automatically checked against a candidate&rsquo;s records.
          </p>
          <Button type="submit" disabled={creating}>{creating ? 'Creating...' : 'Create'}</Button>
        </form>
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
      </Card>

      <SectionHeading count={vacancies.length}>Vacancies</SectionHeading>
      {vacancies.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No vacancies yet.</p>}
      {vacancies.map((v) => (
        <Card key={v.id}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>{v.title}</strong>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{v.jobRef}</span>
                <StatusBadge status={v.status} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Building2 size={13.5} />
                  {v.department?.directorate?.name} &mdash; {v.department?.name}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FileStack size={13.5} /> {v._count?.applications ?? 0} application(s)
                </span>
                {v.deadline && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Calendar size={13.5} /> Deadline: {new Date(v.deadline).toLocaleDateString()}
                  </span>
                )}
              </div>
              {v.reportsToPosition && (
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Reports to {v.reportsToPosition.name}
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border-subtle)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Link to={`/hr/vacancy/${v.id}`} style={{ fontSize: 13.5, fontWeight: 500 }}>View applications</Link>
            <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => openEdit(v)}>Edit</Button>
            {/* SIMPLIFIED - the Senior HR Officer review stage and its
                "awaiting review" status line are both removed entirely,
                not just hidden. The 2-tier flow goes straight from
                PendingApproval to a Manager/Director's direct approval. */}
            {v.status === 'PendingApproval' && canApprove && (
              <Button variant="secondary" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => approve(v.id)}>Approve</Button>
            )}
            {v.status === 'Closed' && canApprove && (
              <Button variant="secondary" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => approve(v.id)}>Re-open</Button>
            )}
            {/* NEW - Internal <-> External transition, restricted to the
                same Manager/Director tier as approval, and only while the
                vacancy is actually live (Open/PartiallyFilled) - matches
                the server-side guard in transitionPostingType() exactly,
                so this button never appears somewhere the backend would
                refuse it anyway. */}
            {['Open', 'PartiallyFilled'].includes(v.status) && canTransition && (
              <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }}
                onClick={() => transitionPostingType(v.id, v.postingType === 'Internal' ? 'External' : 'Internal')}>
                Transition to {v.postingType === 'Internal' ? 'External' : 'Internal'}
              </Button>
            )}
            {v.status !== 'Closed' && canApprove && (
              <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13, color: 'var(--color-danger)' }}
                onClick={() => closeVacancy(v.id)}>Close vacancy</Button>
            )}
          </div>
        </Card>
      ))}

      {editModal && (
        <Modal
          title={`Edit vacancy — ${editModal.jobRef}`}
          onClose={() => setEditModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </>}
        >
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            Title, Department, and Reports To are fixed at creation and cannot be changed here.
          </p>
          <TextField label="Positions required" type="number" min="1" value={editForm.positionsRequired}
            onChange={(e) => setEditForm({ ...editForm, positionsRequired: Number(e.target.value) })} />
          {/* This plain edit-form Select is for pre-approval changes only
              (no audit trail beyond ordinary editing). Once a vacancy is
              actually Open/PartiallyFilled, changing posting type here is
              blocked server-side - use the audited Transition action on
              the vacancy card instead, which is the only path once it's live. */}
          <Select label="Posting type" value={editForm.postingType} onChange={(e) => setEditForm({ ...editForm, postingType: e.target.value })} required>
            <option value="">Select one</option>
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <TextField label="Deadline" type="date" value={editForm.deadline}
            onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} />
          <TextField label="Salary level / scale" value={editForm.salaryScale}
            onChange={(e) => setEditForm({ ...editForm, salaryScale: e.target.value })} />
          <RichTextField label="Job description" value={editForm.description}
            onChange={(html) => setEditForm({ ...editForm, description: html })} />
          <TextField label="Minimum experience (years, optional)" type="number" min="0"
            value={editForm.minimumExperienceYears}
            onChange={(e) => setEditForm({ ...editForm, minimumExperienceYears: e.target.value })} />
          <Select label="Minimum education level (optional)" value={editForm.minimumEducationLevel}
            onChange={(e) => setEditForm({ ...editForm, minimumEducationLevel: e.target.value })}>
            <option value="">No minimum</option>
            <option value="Certificate">Certificate</option>
            <option value="Diploma">Diploma</option>
            <option value="Bachelors">Bachelor's</option>
            <option value="Masters">Master's</option>
            <option value="PhD">PhD</option>
          </Select>
          <TextField label="Preferred field of study (optional, informational only)"
            value={editForm.preferredFieldOfStudy}
            onChange={(e) => setEditForm({ ...editForm, preferredFieldOfStudy: e.target.value })} />
        </Modal>
      )}
    </div>
  );
}
