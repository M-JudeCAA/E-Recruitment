import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

const emptyForm = { title: '', department: '', positionsRequired: 1, postingType: 'Open', deadline: '' };

export default function HRDashboard() {
  const { staff } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false); // double-submission lock
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editModal, setEditModal] = useState(null); // vacancy being edited
  const [editForm, setEditForm] = useState(emptyForm);

  const load = () => staffClient.get('/api/vacancies/admin').then((res) => setVacancies(res.data));
  useEffect(() => { load(); }, []);

  const createVacancy = async (e) => {
    e.preventDefault();
    if (creating) return; // a double-click or slow network retry must not create two vacancies
    setMessage(''); setError(''); setCreating(true);
    try {
      await staffClient.post('/api/vacancies', form);
      setMessage('Vacancy created. It needs Principal HR Officer approval to open.');
      setForm(emptyForm);
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Failed to create vacancy'));
    } finally {
      setCreating(false);
    }
  };

  const approve = async (id) => {
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

  const openEdit = (v) => {
    setError('');
    setEditForm({
      title: v.title, department: v.department, positionsRequired: v.positionsRequired,
      postingType: v.postingType, deadline: v.deadline ? v.deadline.slice(0, 10) : ''
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
          <TextField label="Title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <TextField label="Department" value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })} required />
          <TextField label="Positions required" type="number" min="1" value={form.positionsRequired}
            onChange={(e) => setForm({ ...form, positionsRequired: Number(e.target.value) })} />
          <Select label="Posting type" value={form.postingType} onChange={(e) => setForm({ ...form, postingType: e.target.value })}>
            <option value="Open">Open (internal + external)</option>
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <TextField label="Deadline" type="date" value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          <Button type="submit" disabled={creating}>{creating ? 'Creating...' : 'Create'}</Button>
        </form>
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
      </Card>

      <h3>Vacancies</h3>
      {vacancies.map((v) => (
        <Card key={v.id}>
          <strong>{v.title}</strong> &mdash; <StatusBadge status={v.status} /> &middot; {v._count?.applications ?? 0} application(s)
          {v.deadline && <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Deadline: {new Date(v.deadline).toLocaleDateString()}
          </span>}
          <div style={{ marginTop: 8 }}>
            <Link to={`/hr/vacancy/${v.id}`}>View applications</Link>
            <Button variant="ghost" style={{ marginLeft: 12, padding: '2px 10px' }} onClick={() => openEdit(v)}>Edit</Button>
            {v.status === 'Open' && staff?.role !== 'HR_Officer' && (
              <Button variant="secondary" style={{ marginLeft: 8, padding: '2px 10px' }} onClick={() => approve(v.id)}>Re-approve</Button>
            )}
            {v.status !== 'Closed' && staff?.role !== 'HR_Officer' && (
              <Button variant="ghost" style={{ marginLeft: 8, padding: '2px 10px', color: 'var(--color-danger)' }}
                onClick={() => closeVacancy(v.id)}>Close vacancy</Button>
            )}
          </div>
        </Card>
      ))}

      {editModal && (
        <Modal
          title={`Edit vacancy — ${editModal.title}`}
          onClose={() => setEditModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </>}
        >
          <TextField label="Title" value={editForm.title}
            onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
          <TextField label="Department" value={editForm.department}
            onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} />
          <TextField label="Positions required" type="number" min="1" value={editForm.positionsRequired}
            onChange={(e) => setEditForm({ ...editForm, positionsRequired: Number(e.target.value) })} />
          <Select label="Posting type" value={editForm.postingType} onChange={(e) => setEditForm({ ...editForm, postingType: e.target.value })}>
            <option value="Open">Open (internal + external)</option>
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <TextField label="Deadline" type="date" value={editForm.deadline}
            onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} />
        </Modal>
      )}
    </div>
  );
}
