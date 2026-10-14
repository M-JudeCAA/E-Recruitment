import React, { useCallback, useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import Alert from '../components/Alert';
import Button from '../components/Button';
import Skeleton from '../components/Skeleton';
import ReasonDialog from '../components/ReasonDialog';
import { PageTop, Panel, Table, Pill } from '../components/workspace/ui';

// The HR team (/hr/team): an HR Manager (or Director) in the HR department
// sees the HR department's staff accounts and changes their HR roles - for
// staff ranked below them, to a role below their own (backend
// staffUserController.hrTeam / updateHrTeamRole). They can't add accounts,
// deactivate them or move them between departments - a system administrator
// does that on Staff accounts.

const roleLabel = (role) => (role ? role.replace(/_/g, ' ') : 'No HR role');

export default function HrTeam() {
  const [team, setTeam] = useState(null);
  const [edits, setEdits] = useState({});
  const [confirming, setConfirming] = useState(null); // { account, role }
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => staffClient.get('/api/staff-users/hr-team')
    .then((res) => { setTeam(res.data); setError(''); })
    .catch((err) => { setTeam({ accounts: [], assignableRoles: [] }); setError(err.response?.data?.error || 'Could not load the HR team'); }), []);
  useEffect(() => { load(); }, [load]);

  const save = async (comment) => {
    const { account, role } = confirming;
    await staffClient.patch(`/api/staff-users/hr-team/${account.id}/role`, { role, comment: comment || undefined });
    setConfirming(null);
    setEdits((e) => { const next = { ...e }; delete next[account.id]; return next; });
    setMessage(`${account.name} is now ${roleLabel(role)}. It applies from their next action in the system.`);
    load();
  };

  const accounts = team?.accounts || [];
  const roles = team?.assignableRoles || [];

  const columns = [
    {
      key: 'name', label: 'Name', render: (a) => (
        <><span className="t">{a.name}</span><div className="s">{a.email}</div></>
      )
    },
    {
      key: 'role', label: 'HR role', render: (a) => {
        if (a.lockedReason) return <span title={a.lockedReason}>{roleLabel(a.role)}</span>;
        const value = edits[a.id] ?? a.role;
        return (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select className="ws-field" value={value} aria-label={`HR role for ${a.name}`}
              onChange={(e) => setEdits({ ...edits, [a.id]: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            {value !== a.role && (
              <Button style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setConfirming({ account: a, role: value })}>Save</Button>
            )}
          </div>
        );
      }
    },
    {
      key: 'status', label: 'Status', width: 120, render: (a) => (
        <>
          <Pill tone={a.active ? 'ok' : 'neutral'}>{a.active ? 'Active' : 'Deactivated'}</Pill>
          {a.isSystemAdmin && <div className="s">System administrator</div>}
        </>
      )
    },
    { key: 'signin', label: 'Last sign-in', width: 170, render: (a) => <span className="s">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : 'Never'}</span> },
    { key: 'note', label: '', render: (a) => (a.lockedReason ? <span className="ws-note">{a.lockedReason}</span> : null) }
  ];

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="hr-team" />
      <div className="ws-page" style={{ flex: 1, minWidth: 0 }}>
        <PageTop
          title="HR team"
          subtitle="The HR department's staff and their HR roles. You can change the role of anyone ranked below you, to a role below your own."
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
        <Panel padded={false}>
          {!team ? (
            <div className="ws-panel-b">{[0, 1, 2].map((i) => <Skeleton key={i} width={`${70 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table rows={accounts} getRowKey={(a) => a.id} columns={columns} emptyText="No staff accounts in the HR department." />
          )}
        </Panel>
        <p className="ws-note">
          To add someone to the HR team, deactivate an account or move it to another department, ask a system administrator.
          Every role change is recorded in the audit log.
        </p>
      </div>

      {confirming && (
        <ReasonDialog
          title={`Change ${confirming.account.name}'s role`}
          intro={`${confirming.account.name} goes from ${roleLabel(confirming.account.role)} to ${roleLabel(confirming.role)}. What they can do in the system changes straight away.`}
          label="Reason (optional)"
          minLength={0}
          confirmLabel="Change role"
          busyLabel="Changing..."
          onSubmit={save}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
