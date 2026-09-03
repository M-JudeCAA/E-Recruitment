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

export default function HRDashboard() {
  const { staff } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [form, setForm] = useState({ title: '', department: '', positionsRequired: 1, postingType: 'Open', deadline: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => staffClient.get('/api/vacancies/admin').then((res) => setVacancies(res.data));
  useEffect(() => { load(); }, []);

  const createVacancy = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      await staffClient.post('/api/vacancies', form);
      setMessage('Vacancy created and awaiting Principal HR Officer approval before it is published.');
      setForm({ title: '', department: '', positionsRequired: 1, postingType: 'Open', deadline: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create vacancy');
    }
  };

  const myVacancies = vacancies.filter((v) => v.createdById === staff?.id);

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
          <Button type="submit">Create</Button>
        </form>
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
      </Card>

      <h3>My requisitions</h3>
      {myVacancies.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>You haven't submitted any vacancies yet.</p>}
      {myVacancies.map((v) => (
        <Card key={v.id}>
          <strong>{v.title}</strong> &mdash; <StatusBadge status={v.status} /> &middot; {v._count?.applications ?? 0} application(s)
          <div style={{ marginTop: 8 }}>
            <Link to={`/hr/vacancy/${v.id}`}>View applications</Link>
          </div>
          {v.status === 'PendingApproval' && (
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>Awaiting Principal HR Officer approval.</div>
          )}
          {v.status === 'Rejected' && (
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Rejected{v.approvedBy?.name ? ` by ${v.approvedBy.name}` : ''}{v.rejectionReason ? ` — ${v.rejectionReason}` : ''}
            </div>
          )}
          {v.status === 'Open' && v.approvedBy?.name && (
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>Approved by {v.approvedBy.name}</div>
          )}
        </Card>
      ))}
    </div>
  );
}
