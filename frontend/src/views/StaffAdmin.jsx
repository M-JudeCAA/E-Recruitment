import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import StatTile from '../components/StatTile';
import SectionHeading from '../components/SectionHeading';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';

// The only two roles this screen can ever create or move an account
// between - matches CREATABLE_ROLES in staffUserController.js exactly.
const CREATABLE_ROLES = ['HR_Officer', 'Senior_HR_Officer'];

const emptyForm = { name: '', email: '', role: 'HR_Officer' };

// The whole page is Principal HR Officer+ (see App.jsx's route guard) -
// no lower-tier viewer ever reaches this component, so unlike
// DepartmentAdmin's isReviewer split, everything here is unconditional.
export default function StaffAdmin() {
  const [staffList, setStaffList] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [roleEdits, setRoleEdits] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStaff = () => staffClient.get('/api/staff-users')
    .then((res) => setStaffList(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load staff'));

  useEffect(() => { loadStaff(); }, []);

  const createAccount = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      await staffClient.post('/api/staff-users', form);
      setMessage(`Account created for ${form.name}. They have been emailed a link to set their password.`);
      setForm(emptyForm);
      loadStaff();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create account');
    }
  };

  const changeRole = async (id) => {
    setMessage(''); setError('');
    const role = roleEdits[id];
    if (!role) return;
    try {
      await staffClient.patch(`/api/staff-users/${id}/role`, { role });
      setMessage('Role updated.');
      loadStaff();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update role');
    }
  };

  return (
    <div>
      <PageHeader eyebrow="HR" title="Staff accounts" subtitle="HR Officer and Senior HR Officer accounts" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <StatTile icon={Users} label="HR team members" value={staffList.length} />
      </div>

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Card>
        <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>Create an account</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Only HR Officer and Senior HR Officer accounts can be created here. The new user is emailed a
          link to set their own password - no password is ever entered on their behalf.
        </p>
        <form onSubmit={createAccount}>
          <TextField label="Full name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <TextField label="Email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Select label="Role" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {CREATABLE_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </Select>
          <Button type="submit">Create account</Button>
        </form>
      </Card>

      <SectionHeading count={staffList.length}>HR team</SectionHeading>
      {staffList.map((s) => (
        <Card key={s.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: '50%', background: 'var(--color-primary-tint)',
              color: 'var(--color-primary)', fontWeight: 700, fontSize: 14, flexShrink: 0
            }}>
              {s.name?.[0]?.toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14.5 }}>{s.name}</strong>
                <StatusBadge status={s.role} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{s.email} &mdash; {s.department}</div>
            </div>
            {CREATABLE_ROLES.includes(s.role) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={roleEdits[s.id] || s.role}
                  onChange={(e) => setRoleEdits({ ...roleEdits, [s.id]: e.target.value })}
                  style={{ padding: 7, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-input)', fontSize: 13 }}
                >
                  {CREATABLE_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
                <Button
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  disabled={(roleEdits[s.id] || s.role) === s.role}
                  onClick={() => changeRole(s.id)}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
      {staffList.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No staff accounts found.</p>}
    </div>
  );
}
