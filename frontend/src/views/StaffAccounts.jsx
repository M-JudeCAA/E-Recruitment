import React, { useEffect, useState } from 'react';
import { UserCheck, UserPlus, Users } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import Skeleton from '../components/Skeleton';
import { useConfirm } from '../components/ConfirmDialog';
import DirectoryPersonField from '../components/DirectoryPersonField';
import { isEntraConfigured, searchStaffDirectory } from '../models/entraAuth';
import { STAFF_DEPARTMENTS, HR_DEPARTMENT } from '../utils/staffDepartments';

// The five HR roles - matches ROLE_RANK in backend/src/middleware/auth.js.
const ROLES = ['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director'];
const roleLabel = (role) => (role ? role.replace(/_/g, ' ') : 'No HR role');
const emptyForm = { name: '', email: '', role: 'HR_Officer', department: 'HR', isSystemAdmin: false, entraObjectId: null };
const RECENT_DAYS = 7;

// UCAA staff matching a name or email: Graph in the browser with the
// administrator's own Microsoft session, else the API's directory
// connection. Rejects with `unavailable` when neither can search.
async function searchDirectory(q) {
  if (isEntraConfigured('staff')) {
    try { return await searchStaffDirectory(q); } catch { /* try the API */ }
  }
  try {
    return (await staffClient.get('/api/directory/people', { params: { q } })).data;
  } catch (err) {
    throw Object.assign(new Error(err.response?.data?.error || 'The UCAA directory could not be searched'),
      { unavailable: err.response?.data?.code === 'DIRECTORY_NOT_CONFIGURED' });
  }
}

const checkboxRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22, fontSize: 14 };
const inlineSelect = { padding: 4, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 12 };

// The directory's department text, when it is one of ours (HR / ICT).
const ourDepartment = (text) => STAFF_DEPARTMENTS.find((d) => d === String(text || '').trim().toUpperCase());

// Staff account administration, for system administrators only (backend:
// requireSystemAdmin on /api/staff-users writes). Staff sign in with their
// UCAA Microsoft account, so an account here is what decides whether a UCAA
// employee may sign in to the staff portal at all, and with which role.
// There are no passwords to set; an account links itself to the person's
// Microsoft identity on their first sign-in. Nobody can change their own
// account - so an administrator can't hand themselves an HR role.
//
// Where the staff app's Entra group is managed from here (backend
// staffGroupService), the person must be picked from the directory, and
// creating / deactivating / reactivating the account adds them to or
// removes them from that group; "Staff app access" shows where each account
// stands, with Retry when it didn't go through.
export default function StaffAccounts() {
  const { staff: me } = useAuth();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [roleEdits, setRoleEdits] = useState({});
  const [busy, setBusy] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [directoryDown, setDirectoryDown] = useState(false);
  // People assigned to the staff app in Entra with no account yet:
  // { people } | { unavailable: message } | null while loading.
  const [waiting, setWaiting] = useState(null);
  const [waitingRoles, setWaitingRoles] = useState({});
  // Whether the staff app's Entra group is managed from here.
  const [groupManaged, setGroupManaged] = useState(false);
  const [warning, setWarning] = useState('');

  // Your own row is read-only (the API refuses changes to it anyway).
  const isMe = (a) => a.email?.toLowerCase() === me?.email?.toLowerCase();

  const loadWaiting = () => staffClient.get('/api/staff-users/entra-assignments')
    .then((res) => setWaiting({ people: res.data }))
    .catch((err) => setWaiting({ unavailable: err.response?.data?.error || 'People assigned in Entra could not be listed.' }));

  const load = () => {
    loadWaiting();
    return staffClient.get('/api/staff-users/accounts')
      .then((res) => setAccounts(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load staff accounts'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    staffClient.get('/api/staff-users/entra-group')
      .then((res) => setGroupManaged(Boolean(res.data.configured)))
      .catch(() => setGroupManaged(false));
  }, []);

  // A group change that didn't go through, said next to the action's own message.
  const groupProblem = (name, entraGroup, adding) => (entraGroup?.state === 'Failed'
    ? `${name} could not be ${adding ? 'added to' : 'removed from'} the staff app's group in Microsoft Entra: ${entraGroup.error} Use Retry in the list below - the system administrators have been notified.`
    : '');

  const createAccount = async (body, done) => {
    setMessage(''); setError(''); setWarning('');
    try {
      const { data } = await staffClient.post('/api/staff-users', body);
      const problem = groupProblem(body.name, data.entraGroup, true);
      if (problem) setWarning(`Account created for ${body.name}, but they can't sign in yet. ${problem}`);
      else setMessage(done);
      load();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the account');
      return false;
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    const ok = await createAccount({ ...form, role: form.role || null },
      groupManaged
        ? `Account created for ${form.name} and added to the staff app in Microsoft Entra. They have been emailed to sign in with their UCAA Microsoft account.`
        : `Account created for ${form.name}. They have been emailed to sign in with their UCAA Microsoft account.`);
    if (ok) setForm(emptyForm);
    setCreating(false);
  };

  // One person from the "Waiting for a role" list: the role picked is all
  // that's needed - who they are comes from Entra.
  const createFromEntra = async (person) => {
    const role = waitingRoles[person.entraObjectId] ?? 'HR_Officer';
    setBusy((b) => ({ ...b, [person.entraObjectId]: true }));
    await createAccount({
      name: person.name, email: person.email, role, entraObjectId: person.entraObjectId,
      department: ourDepartment(person.department) || HR_DEPARTMENT, isSystemAdmin: false
    }, `${person.name} can now sign in as ${roleLabel(role)}. They have been emailed.`);
    setBusy((b) => ({ ...b, [person.entraObjectId]: false }));
  };

  const recent = (when) => Date.now() - new Date(when).getTime() < RECENT_DAYS * 86400000;

  const change = async (account, data, done) => {
    setMessage(''); setError(''); setWarning('');
    setBusy((b) => ({ ...b, [account.id]: true }));
    try {
      const { data: updated } = await staffClient.patch(`/api/staff-users/${account.id}`, data);
      setMessage(done);
      setWarning(groupProblem(account.name, updated.entraGroup, updated.active));
      setRoleEdits((r) => { const next = { ...r }; delete next[account.id]; return next; });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update the account');
    } finally {
      setBusy((b) => ({ ...b, [account.id]: false }));
    }
  };

  const toggleActive = async (account) => {
    if (account.active) {
      const ok = await confirm(
        `${account.name} will be signed out at once and won't be able to sign in to the staff portal until reactivated.`,
        { title: 'Deactivate account?', confirmLabel: 'Deactivate', danger: true }
      );
      if (!ok) return;
    }
    change(account, { active: !account.active }, account.active ? `${account.name} deactivated.` : `${account.name} reactivated.`);
  };

  const toggleAdmin = async (account) => {
    if (!account.isSystemAdmin) {
      const ok = await confirm(
        `${account.name} will be able to create staff accounts, change anyone's role and deactivate accounts.`,
        { title: 'Make system administrator?', confirmLabel: 'Make administrator' }
      );
      if (!ok) return;
    }
    change(account, { isSystemAdmin: !account.isSystemAdmin },
      account.isSystemAdmin ? `${account.name} is no longer a system administrator.` : `${account.name} is now a system administrator.`);
  };

  const retryGroup = async (account) => {
    setMessage(''); setError(''); setWarning('');
    setBusy((b) => ({ ...b, [`group-${account.id}`]: true }));
    try {
      const { data } = await staffClient.post(`/api/staff-users/${account.id}/entra-group`, {});
      const problem = groupProblem(account.name, data.entraGroup, data.active);
      if (problem) setWarning(problem);
      else setMessage(data.active ? `${account.name} now has the staff app in Microsoft Entra.` : `${account.name} has been removed from the staff app in Microsoft Entra.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not retry');
    } finally {
      setBusy((b) => ({ ...b, [`group-${account.id}`]: false }));
    }
  };

  const unlink = async (account) => {
    const ok = await confirm(
      `Use this only when ${account.name}'s Microsoft account was deleted and recreated. The account will link to whichever Microsoft account next signs in as ${account.email}.`,
      { title: 'Unlink Microsoft account?', confirmLabel: 'Unlink' }
    );
    if (!ok) return;
    setMessage(''); setError('');
    try {
      await staffClient.post(`/api/staff-users/${account.id}/unlink`, {});
      setMessage(`${account.name}'s account will link again on their next sign-in.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not unlink the account');
    }
  };

  const columns = [
    {
      key: 'name', label: 'Name', render: (a) => (
        <div>
          <div style={{ fontWeight: 600 }}>{a.name}{isMe(a) ? ' (you)' : ''}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{a.email}</div>
        </div>
      )
    },
    {
      key: 'department', label: 'Department', render: (a) => (isMe(a) ? (a.department || '—') : (
        <select value={a.department || ''} style={inlineSelect} aria-label={`Department for ${a.name}`} disabled={!!busy[a.id]}
          onChange={(e) => change(a, { department: e.target.value }, `${a.name} is now in ${e.target.value}.`)}>
          {!STAFF_DEPARTMENTS.includes(a.department) && <option value="" disabled>{a.department || 'Not set'}</option>}
          {STAFF_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      ))
    },
    {
      key: 'role', label: 'HR role', render: (a) => {
        if (isMe(a)) return roleLabel(a.role);
        const value = roleEdits[a.id] ?? (a.role || '');
        return (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={value} style={inlineSelect} aria-label={`HR role for ${a.name}`}
              onChange={(e) => setRoleEdits({ ...roleEdits, [a.id]: e.target.value })}>
              <option value="">No HR role</option>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            {value !== (a.role || '') && (
              <Button style={{ padding: '2px 8px', fontSize: 12 }} loading={!!busy[a.id]} loadingText="…"
                onClick={() => change(a, { role: value || null }, `${a.name} is now ${roleLabel(value || null)}.`)}>
                Save
              </Button>
            )}
          </div>
        );
      }
    },
    { key: 'admin', label: 'System admin', render: (a) => (a.isSystemAdmin ? 'Yes' : 'No') },
    { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.active ? 'Active' : 'Deactivated'} /> },
    ...(groupManaged ? [{
      key: 'access', label: 'Staff app access', render: (a) => (
        a.entraGroupState === 'Failed' ? (
          <div style={{ maxWidth: 260 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status="Failed" label={a.active ? 'Not added' : 'Not removed'} />
              <Button variant="secondary" style={{ padding: '2px 8px', fontSize: 12 }} loading={!!busy[`group-${a.id}`]} loadingText="…"
                onClick={() => retryGroup(a)}>Retry</Button>
            </div>
            {a.entraGroupError && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{a.entraGroupError}</div>}
          </div>
        ) : a.entraGroupState ? (
          <StatusBadge status={a.entraGroupState} label={a.entraGroupState === 'InGroup' ? 'Has access' : 'Removed'} />
        ) : (
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }} title="Made before the staff app's group was managed here - see scripts/syncStaffGroup.js">Not checked</span>
        )
      )
    }] : []),
    {
      key: 'signin', label: 'Last sign-in', render: (a) => (
        <span title={a.linked ? 'Linked to a Microsoft account' : 'Not signed in yet'}>
          {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : 'Never'}
        </span>
      )
    },
    {
      key: 'actions', label: '', align: 'right', render: (a) => (isMe(a) ? null : (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant="ghost" style={{ padding: '2px 8px', fontSize: 12 }} disabled={!!busy[a.id]} onClick={() => toggleAdmin(a)}>
            {a.isSystemAdmin ? 'Remove admin' : 'Make admin'}
          </Button>
          <Button variant={a.active ? 'danger' : 'secondary'} style={{ padding: '2px 8px', fontSize: 12 }} disabled={!!busy[a.id]} onClick={() => toggleActive(a)}>
            {a.active ? 'Deactivate' : 'Reactivate'}
          </Button>
          {a.linked && (
            <Button variant="ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => unlink(a)}>Unlink</Button>
          )}
        </div>
      ))
    }
  ];

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="staff-accounts" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <PageHeader title="Staff accounts" subtitle="Who can sign in to the staff portal, and with which role" />

        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
        <Alert type="warning" message={warning} />

        <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--spacing-sm)' }}>
            <UserCheck size={18} color="var(--color-primary)" />
            <h4 style={{ margin: 0 }}>Waiting for a role</h4>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            People added to the e-Recruitment staff app in Microsoft Entra (under Users and groups) who don't have an account here yet.
            Give each a role and they can sign in.
          </p>
          {!waiting ? <Skeleton width="100%" height={18} />
            : waiting.unavailable ? <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>{waiting.unavailable} Use Create an account below instead.</p>
              : waiting.people.length === 0 ? <p style={{ fontSize: 13, margin: 0 }}>Everyone assigned to the staff app in Entra has an account.</p>
                : (
                  <DataTable getRowKey={(p) => p.entraObjectId} rows={waiting.people} emptyText="" columns={[
                    {
                      key: 'name', label: 'Person', render: (p) => (
                        <div>
                          <div style={{ fontWeight: 600 }}>{p.name}{p.jobTitle ? <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}> · {p.jobTitle}</span> : null}</div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{p.email}{p.department ? ` · ${p.department}` : ''}</div>
                        </div>
                      )
                    },
                    {
                      key: 'assigned', label: 'Added in Entra', render: (p) => (
                        <span>
                          {new Date(p.assignedAt).toLocaleDateString()}
                          {recent(p.assignedAt) && <> <StatusBadge status="New" /></>}
                          {p.via && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>through {p.via}</div>}
                        </span>
                      )
                    },
                    {
                      key: 'role', label: 'Role', render: (p) => (
                        <select style={inlineSelect} aria-label={`HR role for ${p.name}`}
                          value={waitingRoles[p.entraObjectId] ?? 'HR_Officer'}
                          onChange={(e) => setWaitingRoles({ ...waitingRoles, [p.entraObjectId]: e.target.value })}>
                          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                      )
                    },
                    {
                      key: 'go', label: '', align: 'right', render: (p) => (
                        <Button style={{ padding: '2px 10px', fontSize: 12 }} loading={!!busy[p.entraObjectId]} loadingText="…"
                          onClick={() => createFromEntra(p)}>Create account</Button>
                      )
                    }
                  ]} />
                )}
        </Card>

        <Card accent="var(--color-primary)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--spacing-md)' }}>
            <UserPlus size={18} color="var(--color-primary)" />
            <h4 style={{ margin: 0 }}>Create an account</h4>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Start typing the person's name and pick them from the UCAA directory - their email comes with them, and it is the
            Microsoft account they sign in with. There is no password; they are emailed a link to the staff portal.
            {groupManaged && ' Creating the account also gives them the staff app in Microsoft Entra.'} Any UCAA
            employee can apply for jobs on the candidate site without an account here.
          </p>
          <form onSubmit={create}>
            <DirectoryPersonField label="Full name" required value={form.name}
              picked={Boolean(form.entraObjectId)} unavailable={directoryDown} search={searchDirectory}
              onUnavailable={() => setDirectoryDown(true)}
              hint={directoryDown
                ? (groupManaged
                  ? 'The UCAA directory can\'t be searched just now, and an account needs someone picked from it. Try again shortly.'
                  : 'The UCAA directory can\'t be searched here - type the name and UCAA email.')
                : (groupManaged && form.name && !form.entraObjectId ? 'Pick the person from the list.' : undefined)}
              onType={(name) => setForm((f) => ({ ...f, name, ...(f.entraObjectId ? { email: '', entraObjectId: null } : {}) }))}
              onPick={(person) => setForm((f) => ({
                ...f, name: person.name, email: person.email, entraObjectId: person.entraObjectId || null,
                department: ourDepartment(person.department) || f.department
              }))} />
            <TextField label="UCAA email" type="email" value={form.email} required
              disabled={Boolean(form.entraObjectId)}
              hint={form.entraObjectId ? 'From the UCAA directory. Type a different name to change it.' : undefined}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Select label="HR role" value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              <option value="">No HR role (system administrator only)</option>
            </Select>
            <Select label="Department" value={form.department}
              hint="HR staff can have their HR role managed by the HR Manager."
              onChange={(e) => setForm({ ...form, department: e.target.value })}>
              {STAFF_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
            <label style={checkboxRow}>
              <input type="checkbox" checked={form.isSystemAdmin}
                onChange={(e) => setForm({ ...form, isSystemAdmin: e.target.checked })} />
              System administrator - can manage staff accounts
            </label>
            <Button type="submit" loading={creating} loadingText="Creating..."
              disabled={groupManaged && !form.entraObjectId}>Create account</Button>
          </form>
        </Card>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 'var(--spacing-lg) 0 var(--spacing-md)' }}>
          <Users size={18} color="var(--color-primary)" />
          <h4 style={{ margin: 0 }}>All accounts</h4>
        </div>
        <Card style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 16 }}>
              {[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={18} style={{ marginBottom: 10 }} />)}
            </div>
          ) : (
            <DataTable getRowKey={(a) => a.id} rows={accounts} columns={columns} emptyText="No staff accounts yet." />
          )}
        </Card>
      </div>
    </div>
  );
}
