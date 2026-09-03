import React, { useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Select from '../components/Select';
import TextArea from '../components/TextArea';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
const ROLE_BY_RANK = Object.fromEntries(Object.entries(ROLE_RANK).map(([role, rank]) => [rank, role]));

// The role exactly one tier below the given one, or null (matches
// delegationController.js's tierBelow - an HR Officer has nobody below
// them, which is why this whole feature is gated to Senior HR Officer+).
function tierBelow(role) {
  return ROLE_BY_RANK[(ROLE_RANK[role] || 0) - 1] || null;
}

const emptyForm = { delegateId: '', startDate: '', endDate: '', reason: '' };

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString();
}

export default function DelegationAdmin() {
  const { staff } = useAuth();
  const delegateRole = tierBelow(staff?.role);
  // Principal HR Officer+ gets the full cross-team history from the
  // API; everyone else only ever receives their own delegations - the
  // heading just reflects what the backend already scoped.
  const isOversight = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  const [staffList, setStaffList] = useState([]);
  const [delegations, setDelegations] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStaffList = () => staffClient.get('/api/staff-users')
    .then((res) => setStaffList(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load staff'));
  const loadDelegations = () => staffClient.get('/api/delegations')
    .then((res) => setDelegations(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load delegations'));

  useEffect(() => {
    loadStaffList();
    loadDelegations();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      await staffClient.post('/api/delegations', form);
      setMessage('Delegation created.');
      setForm(emptyForm);
      loadDelegations();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create delegation');
    }
  };

  const eligibleDelegates = staffList.filter((s) => s.role === delegateRole);

  return (
    <div>
      <PageHeader title="Delegations" subtitle="Temporarily delegate your own authority to a subordinate" />
      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Card accent="var(--color-primary)">
        <h3 style={{ marginTop: 0 }}>Delegate your authority</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          While active, the person you choose can act with your permissions in addition to their own - you
          do not lose access yourself. You can only delegate to a {delegateRole ? delegateRole.replace(/_/g, ' ') : '(no eligible tier)'}.
        </p>
        <form onSubmit={submit}>
          <Select label="Delegate to" value={form.delegateId}
            onChange={(e) => setForm({ ...form, delegateId: e.target.value })} required>
            <option value="">Select a staff member</option>
            {eligibleDelegates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <TextField label="Start date" type="date" value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
          <TextField label="End date" type="date" value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
          <TextArea label="Reason" value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <Button type="submit">Create delegation</Button>
        </form>
      </Card>

      <h3>{isOversight ? 'All delegations' : 'My delegations'}</h3>
      {delegations.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>No delegations found.</p>
      )}
      {delegations.map((d) => {
        const active = new Date(d.startDate) <= new Date() && new Date() <= new Date(d.endDate);
        return (
          <Card key={d.id}>
            <strong>{d.delegate.name}</strong> acting for <strong>{d.delegator.name}</strong>{' '}
            <StatusBadge status={active ? 'Open' : 'Closed'} />
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {fmt(d.startDate)} &ndash; {fmt(d.endDate)} &middot; {d.reason}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
