import React, { useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';

const emptyDeptForm = { name: '', directorateId: '' };
const emptyPositionForm = { name: '', departmentId: '', level: 1 };
const emptyDirectorateForm = { name: '', directorName: '', directorEmail: '' };

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK. Approving/
// rejecting a department and creating a directorate are both Principal HR
// Officer+ capabilities - "not HR_Officer" would wrongly include Senior HR
// Officer, who the backend would 403.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function DepartmentAdmin() {
  const { staff } = useAuth();
  const isReviewer = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  const [directorates, setDirectorates] = useState([]);
  const [approvedDepartments, setApprovedDepartments] = useState([]);
  const [pendingDepartments, setPendingDepartments] = useState([]);

  const [deptForm, setDeptForm] = useState(emptyDeptForm);
  const [positionForm, setPositionForm] = useState(emptyPositionForm);
  const [directorateForm, setDirectorateForm] = useState(emptyDirectorateForm);
  const [rejectReason, setRejectReason] = useState({});

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadDirectorates = () => staffClient.get('/api/directorates')
    .then((res) => setDirectorates(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load directorates'));
  const loadApprovedDepartments = () => staffClient.get('/api/departments/approved')
    .then((res) => setApprovedDepartments(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load departments'));
  const loadPending = () => staffClient.get('/api/departments/pending')
    .then((res) => setPendingDepartments(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load pending departments'));

  useEffect(() => {
    loadDirectorates();
    loadApprovedDepartments();
    if (isReviewer) loadPending();
  }, [isReviewer]);

  const proposeDepartment = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      await staffClient.post('/api/departments', deptForm);
      setMessage('Department proposed. It needs Principal HR Officer approval before it can be used on a vacancy.');
      setDeptForm(emptyDeptForm);
      loadApprovedDepartments();
      if (isReviewer) loadPending();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not propose department');
    }
  };

  const createDirectorate = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      await staffClient.post('/api/directorates', directorateForm);
      setMessage('Directorate created.');
      setDirectorateForm(emptyDirectorateForm);
      loadDirectorates();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create directorate');
    }
  };

  const approveDepartment = async (id) => {
    setError('');
    try {
      await staffClient.patch(`/api/departments/${id}/approve`);
      loadPending();
      loadApprovedDepartments();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve department');
    }
  };

  const rejectDepartment = async (id) => {
    setError('');
    const reason = rejectReason[id];
    if (!reason || !reason.trim()) { setError('A rejection reason is required'); return; }
    try {
      await staffClient.patch(`/api/departments/${id}/reject`, { reason });
      loadPending();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reject department');
    }
  };

  const createPosition = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      await staffClient.post('/api/positions', positionForm);
      setMessage('Position added.');
      setPositionForm(emptyPositionForm);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add position');
    }
  };

  return (
    <div>
      <PageHeader title="Departments & positions" subtitle="Manage the org structure vacancies are built on" />
      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Card accent="var(--color-primary)">
        <h3 style={{ marginTop: 0 }}>Propose a department</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          New departments need Principal HR Officer approval before they can be used on a vacancy - unlike
          positions, which any HR Officer can add directly.
        </p>
        <form onSubmit={proposeDepartment}>
          <TextField label="Department name" value={deptForm.name}
            onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} required />
          <Select label="Directorate" value={deptForm.directorateId}
            onChange={(e) => setDeptForm({ ...deptForm, directorateId: e.target.value })} required>
            <option value="">Select a directorate</option>
            {directorates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Button type="submit">Propose department</Button>
        </form>
      </Card>

      <Card accent="var(--color-accent)">
        <h3 style={{ marginTop: 0 }}>Add a position</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No approval workflow, unlike departments - any HR Officer can add a position directly to an
          approved department.
        </p>
        <form onSubmit={createPosition}>
          <TextField label="Position name" value={positionForm.name}
            onChange={(e) => setPositionForm({ ...positionForm, name: e.target.value })} required />
          <Select label="Department" value={positionForm.departmentId}
            onChange={(e) => setPositionForm({ ...positionForm, departmentId: e.target.value })} required>
            <option value="">Select a department</option>
            {approvedDepartments.map((d) => (
              <option key={d.id} value={d.id}>{d.directorate.name} &mdash; {d.name}</option>
            ))}
          </Select>
          <TextField label="Seniority level" type="number" min="1" value={positionForm.level}
            onChange={(e) => setPositionForm({ ...positionForm, level: Number(e.target.value) })} />
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Higher number = more senior. Only compared against other positions in the same department.
          </p>
          <Button type="submit">Add position</Button>
        </form>
      </Card>

      {isReviewer && (
        <Card accent="var(--color-border)" style={{ background: 'var(--color-bg-subtle)' }}>
          <h3 style={{ marginTop: 0 }}>Add a directorate</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Directorates are foundational and rarely change, unlike departments - restricted to Principal
            HR Officer and above.
          </p>
          <form onSubmit={createDirectorate}>
            <TextField label="Directorate name" value={directorateForm.name}
              onChange={(e) => setDirectorateForm({ ...directorateForm, name: e.target.value })} required />
            <TextField label="Director's name (optional)" value={directorateForm.directorName}
              onChange={(e) => setDirectorateForm({ ...directorateForm, directorName: e.target.value })} />
            <TextField label="Director's email (optional)" value={directorateForm.directorEmail}
              onChange={(e) => setDirectorateForm({ ...directorateForm, directorEmail: e.target.value })} />
            <Button type="submit">Add directorate</Button>
          </form>
        </Card>
      )}

      {isReviewer && (
        <>
          <h3>Pending departments</h3>
          {pendingDepartments.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No departments awaiting approval.</p>
          )}
          {pendingDepartments.map((d) => (
            <Card key={d.id}>
              <strong>{d.directorate.name} &mdash; {d.name}</strong> <StatusBadge status={d.status} />
              {d.createdBy?.name && <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>proposed by {d.createdBy.name}</span>}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Button style={{ padding: '2px 10px' }} onClick={() => approveDepartment(d.id)}>Approve</Button>
                <input
                  placeholder="Rejection reason"
                  value={rejectReason[d.id] || ''}
                  onChange={(e) => setRejectReason({ ...rejectReason, [d.id]: e.target.value })}
                  style={{ flex: 1, padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                />
                <Button variant="ghost" style={{ padding: '2px 10px', color: 'var(--color-danger)' }}
                  onClick={() => rejectDepartment(d.id)}>Reject</Button>
              </div>
            </Card>
          ))}
        </>
      )}

      <h3>Approved departments</h3>
      {Object.entries(
        approvedDepartments.reduce((groups, d) => {
          const key = d.directorate.name;
          (groups[key] = groups[key] || []).push(d);
          return groups;
        }, {})
      ).map(([directorateName, depts]) => (
        <Card key={directorateName}>
          <strong>{directorateName}</strong>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
            {depts.map((d) => d.name).join(', ')}
          </div>
        </Card>
      ))}
    </div>
  );
}
