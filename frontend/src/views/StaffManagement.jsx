import React, { useEffect, useState } from 'react';
import { Users, Share2 } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
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

// The only two roles this screen can ever create or move an account
// between - matches CREATABLE_ROLES in staffUserController.js exactly.
const CREATABLE_ROLES = ['HR_Officer', 'Senior_HR_Officer'];
const emptyAccountForm = { name: '', email: '', role: 'HR_Officer' };
const emptyDelegationForm = { delegateId: '', startDate: '', endDate: '', reason: '' };

// The role exactly one tier below the given one, or null (matches
// delegationController.js's tierBelow - an HR Officer has nobody below
// them, which is why the Delegations section is gated to Senior HR
// Officer+ same as before).
function tierBelow(role) {
  return ROLE_BY_RANK[(ROLE_RANK[role] || 0) - 1] || null;
}

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString();
}

// Create an account, plus the HR team roster with inline role changes -
// unchanged from the old standalone StaffAdmin page other than living as
// a section here. Still Principal HR Officer+ only (see staffUserController.js's
// create/updateRole gates) - the parent component only renders this
// section at all once that's already confirmed.
function StaffAccountsSection() {
  const [staffList, setStaffList] = useState([]);
  const [form, setForm] = useState(emptyAccountForm);
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
      setForm(emptyAccountForm);
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
    <section style={{ marginBottom: 'var(--spacing-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--spacing-md)' }}>
        <Users size={18} color="var(--color-primary)" />
        <h3 style={{ margin: 0 }}>Staff accounts</h3>
      </div>

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Card accent="var(--color-primary)">
        <h4 style={{ marginTop: 0 }}>Create an account</h4>
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

      <h4>HR team</h4>
      {staffList.map((s) => (
        <Card key={s.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>{s.name}</strong> <StatusBadge status={s.role} />
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{s.email} &mdash; {s.department}</div>
            </div>
            {CREATABLE_ROLES.includes(s.role) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={roleEdits[s.id] || s.role}
                  onChange={(e) => setRoleEdits({ ...roleEdits, [s.id]: e.target.value })}
                  style={{ padding: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                >
                  {CREATABLE_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
                <Button
                  style={{ padding: '4px 10px' }}
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
      {staffList.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No staff accounts found.</p>}
    </section>
  );
}

// Unchanged from the old standalone DelegationAdmin page other than
// living as a section here - still Senior HR Officer+, the minimum tier
// that can reach this page at all (see App.jsx's route guard), so no
// further role gate is needed within the section itself.
function DelegationsSection() {
  const { staff } = useAuth();
  const delegateRole = tierBelow(staff?.role);
  // Principal HR Officer+ gets the full cross-team history from the
  // API; everyone else only ever receives their own delegations - the
  // heading just reflects what the backend already scoped.
  const isOversight = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  const [staffList, setStaffList] = useState([]);
  const [delegations, setDelegations] = useState([]);
  const [form, setForm] = useState(emptyDelegationForm);
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
      setForm(emptyDelegationForm);
      loadDelegations();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create delegation');
    }
  };

  const eligibleDelegates = staffList.filter((s) => s.role === delegateRole);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--spacing-md)' }}>
        <Share2 size={18} color="var(--color-primary)" />
        <h3 style={{ margin: 0 }}>Delegations</h3>
      </div>

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Card accent="var(--color-primary)">
        <h4 style={{ marginTop: 0 }}>Delegate your authority</h4>
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

      <h4>{isOversight ? 'All delegations' : 'My delegations'}</h4>
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
    </section>
  );
}

// Replaces the old separate StaffAdmin (/hr/staff, Principal HR Officer+)
// and DelegationAdmin (/hr/delegations, Senior HR Officer+) pages, and
// the two Navbar links that used to point to them - both now live under
// one "Staff Management" sidebar entry (HRSidebar.jsx), on one page, so
// managing the HR team and its delegated authority is a single stop
// instead of two disconnected top-nav links. The page itself is gated at
// the lower of the two tiers (Senior HR Officer+, see App.jsx); each
// section below still enforces its own original, unchanged boundary -
// Staff Accounts only renders for Principal HR Officer+, exactly as it
// did as a standalone page.
export default function StaffManagement() {
  const { staff } = useAuth();
  const canManageStaff = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="staff-management" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="Staff Management" subtitle="HR team accounts and delegated authority" />

          {canManageStaff && <StaffAccountsSection />}
          <DelegationsSection />
        </div>
      </div>
    </div>
  );
}
