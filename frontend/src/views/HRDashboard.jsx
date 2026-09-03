import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import RichTextField from '../components/RichTextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

const emptyForm = {
  departmentId: '', positionId: '', reportsToPositionId: '',
  positionsRequired: 1, postingType: 'Open', deadline: '',
  salaryScale: '', description: ''
};

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK - "Approve a
// vacancy" and "Close a vacancy" are Principal HR Officer+ capabilities,
// so gating on rank (not just "not HR_Officer") keeps a Senior HR Officer
// from seeing a button the backend would 403 on.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function HRDashboard() {
  const { staff } = useAuth();
  const canApprove = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;
  // The review/check-by stage - Senior HR Officer+, ahead of PHRO's own
  // (higher-ranked) final approval.
  const canReview = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;

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
      setMessage(`Vacancy created (Ref: ${res.data.jobRef}). It needs Principal HR Officer approval to open.`);
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

  const review = async (id) => {
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/review`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Review failed');
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
      salaryScale: v.salaryScale || '', description: v.description || ''
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

  return (
    <div>
      <PageHeader title="HR dashboard" subtitle={`Logged in as ${staff?.name} (${staff?.role?.replace(/_/g, ' ')})`} />

      <Card accent="var(--color-primary)">
        <h3 style={{ marginTop: 0 }}>Create vacancy</h3>
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
          <Select label="Posting type" value={form.postingType} onChange={(e) => setForm({ ...form, postingType: e.target.value })}>
            <option value="Open">Open (internal + external)</option>
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
          <Button type="submit" disabled={creating}>{creating ? 'Creating...' : 'Create'}</Button>
        </form>
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
      </Card>

      <h3>Vacancies</h3>
      {vacancies.map((v) => (
        <Card key={v.id}>
          <strong>{v.jobRef}</strong> &mdash; {v.title} &middot; <StatusBadge status={v.status} />
          {' '}&middot; {v._count?.applications ?? 0} application(s)
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {v.department?.directorate?.name} &mdash; {v.department?.name}
            {v.reportsToPosition && <> &middot; Reports to {v.reportsToPosition.name}</>}
          </div>
          {v.deadline && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Deadline: {new Date(v.deadline).toLocaleDateString()}
          </span>}
          {['PendingApproval', 'Closed'].includes(v.status) && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {v.reviewedAt
                ? `Reviewed by ${v.reviewedBy?.name || 'a Senior HR Officer'}`
                : 'Awaiting Senior HR Officer review'}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Link to={`/hr/vacancy/${v.id}`}>View applications</Link>
            <Button variant="ghost" style={{ marginLeft: 12, padding: '2px 10px' }} onClick={() => openEdit(v)}>Edit</Button>
            {/* Check-by stage: a Senior HR Officer+ must review before a
                Principal HR Officer can approve - the backend refuses
                approve() with no reviewedAt, so Approve/Re-open are only
                ever shown once that's already true. */}
            {['PendingApproval', 'Closed'].includes(v.status) && !v.reviewedAt && canReview && (
              <Button variant="secondary" style={{ marginLeft: 8, padding: '2px 10px' }} onClick={() => review(v.id)}>Review</Button>
            )}
            {/* FIXED - this used to check status === 'Open', which only ever
                showed "Re-approve" on a vacancy that was already approved and
                needed no action at all. Now correctly split: Approve for a
                fresh vacancy still awaiting its first decision, Re-open for
                one that was previously withdrawn. */}
            {v.status === 'PendingApproval' && v.reviewedAt && canApprove && (
              <Button variant="secondary" style={{ marginLeft: 8, padding: '2px 10px' }} onClick={() => approve(v.id)}>Approve</Button>
            )}
            {v.status === 'Closed' && v.reviewedAt && canApprove && (
              <Button variant="secondary" style={{ marginLeft: 8, padding: '2px 10px' }} onClick={() => approve(v.id)}>Re-open</Button>
            )}
            {v.status !== 'Closed' && canApprove && (
              <Button variant="ghost" style={{ marginLeft: 8, padding: '2px 10px', color: 'var(--color-danger)' }}
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
          <Select label="Posting type" value={editForm.postingType} onChange={(e) => setEditForm({ ...editForm, postingType: e.target.value })}>
            <option value="Open">Open (internal + external)</option>
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <TextField label="Deadline" type="date" value={editForm.deadline}
            onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} />
          <TextField label="Salary level / scale" value={editForm.salaryScale}
            onChange={(e) => setEditForm({ ...editForm, salaryScale: e.target.value })} />
          <RichTextField label="Job description" value={editForm.description}
            onChange={(html) => setEditForm({ ...editForm, description: html })} />
        </Modal>
      )}
    </div>
  );
}
