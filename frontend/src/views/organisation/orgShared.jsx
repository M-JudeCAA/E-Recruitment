import React, { useCallback, useEffect, useState } from 'react';
import staffClient from '../../models/staffApiClient';
import { useAuth } from '../../models/AuthContext';
import { useInbox, refreshInbox } from '../../models/useInbox';
import Button from '../../components/Button';
import TextField from '../../components/TextField';
import ReasonDialog from '../../components/ReasonDialog';
import { useConfirm } from '../../components/ConfirmDialog';
import { Pill, KeyValues, currentStaffId, formatDay, rankOf, ROLE_RANK } from '../../components/workspace/ui';
import { approveOrg, rejectOrg, ORG_WORD } from '../../utils/orgApproval';
import { codeError, normalizeCode, CODE_MAX } from '../../utils/orgFields';

// What the Organisation pages share (views/organisation/): who may do what,
// status pills, approval deadlines, the side panel's actions, and the code
// and name fields. The rules themselves are the API's
// (orgApprovalService / orgAdminService); this only decides what to show.

export const BASE = { directorate: '/api/directorates', department: '/api/departments', position: '/api/positions' };
export const ORG_TASK_TYPES = { DirectorateApproval: 'directorate', DepartmentApproval: 'department', PositionApproval: 'position' };

export const STATUS_FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'Approved', label: 'Approved', test: (r) => r.status === 'Approved' },
  { key: 'Pending', label: 'Waiting for approval', test: (r) => r.status === 'Pending' },
  { key: 'Rejected', label: 'Rejected', test: (r) => r.status === 'Rejected' }
];

/**
 * isReviewer: Principal HR Officer or above, by role or an active delegation
 * - approves, edits and deletes anything. Anyone else adds, and corrects or
 * withdraws what they added while it waits.
 */
export function useOrgRights() {
  const { staff } = useAuth();
  const inbox = useInbox({ enabled: Boolean(staff?.role) });
  const rank = Math.max(rankOf(staff?.role), rankOf(inbox?.delegation?.actingFor?.role));
  const me = currentStaffId();
  const isReviewer = rank >= ROLE_RANK.Principal_HR_Officer;
  const ownPending = (row) => row?.status === 'Pending' && row.createdById === me;
  return {
    me,
    isReviewer,
    canDecide: (row) => isReviewer && row?.status === 'Pending' && row.createdById !== me,
    canEdit: (row) => row?.status !== 'Rejected' && (isReviewer || ownPending(row)),
    canDelete: (row) => isReviewer || ownPending(row)
  };
}

const STATUS_TONE = { Approved: 'ok', Pending: 'warn', Rejected: 'bad' };
const STATUS_WORD = { Approved: 'Approved', Pending: 'Waiting for approval', Rejected: 'Rejected' };
export function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_WORD[status] || status}</Pill>;
}

/** A waiting item's deadline, worded as the Inbox words it (inboxService.dueLabel). */
export function Due({ status }) {
  if (!status) return null;
  const hours = status.hoursRemaining;
  let text;
  if (hours <= 0) {
    const over = Math.ceil(-hours / 24);
    text = over <= 1 ? '1 day over' : `${over} days over`;
  } else if (hours < 24) text = 'due today';
  else text = Math.ceil(hours / 24) === 1 ? 'due tomorrow' : `due in ${Math.ceil(hours / 24)} days`;
  return (
    <span className={`ws-due${status.isOverdue ? ' over' : hours < 24 ? ' soon' : ''}`}>
      {text}{status.escalated ? ' · escalated' : ''}
    </span>
  );
}

/** Approval deadlines (backend slaStatusService), as the Inbox shows them. Only approvers see them. */
export function useDeadlines(enabled) {
  const [deadlines, setDeadlines] = useState([]);
  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return staffClient.get('/api/dashboard/follow-ups')
      .then((res) => setDeadlines(res.data.filter((t) => ORG_TASK_TYPES[t.taskType])))
      .catch(() => setDeadlines([]));
  }, [enabled]);
  useEffect(() => { reload(); }, [reload]);
  const byItem = new Map(deadlines.map((t) => [`${ORG_TASK_TYPES[t.taskType]}-${t.taskId}`, t]));
  return {
    reload,
    deadlineOf: (entity, id) => byItem.get(`${entity}-${id}`),
    // An import's deadline is its earliest-due item's.
    importDeadline: (importId) => deadlines.filter((t) => t.importId === importId).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0]
  };
}

/** Who added it and who decided it, for the side panel. */
export function RecordFacts({ row }) {
  return (
    <KeyValues rows={[
      ['Status', <StatusPill status={row.status} />],
      ['Added', `${formatDay(row.createdAt)}${row.createdBy?.name ? ` by ${row.createdBy.name}` : ''}${row.import ? ` (import ${row.import.fileName})` : ''}`],
      row.status !== 'Pending' && row.approvedAt && [row.status === 'Rejected' ? 'Rejected' : 'Approved', `${formatDay(row.approvedAt)}${row.approvedBy?.name ? ` by ${row.approvedBy.name}` : ''}`],
      row.status === 'Rejected' && ['Reason', row.rejectionReason]
    ]} />
  );
}

/**
 * The side panel's buttons for one item: Approve / Reject (an approver,
 * not their own), Edit, Delete (or Withdraw, for your own pending item).
 * onDone(message) after a change; onError(message) when it failed.
 * inUse: what still uses it (e.g. "3 departments") - Delete is then
 * disabled, as the API would refuse it.
 */
export function OrgItemActions({ entity, row, rights, onEdit, onDone, onError, inUse }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const word = ORG_WORD[entity];
  const lower = word.toLowerCase();
  const withdrawing = row.status === 'Pending' && row.createdById === rights.me && !rights.isReviewer;

  const run = async (what, fn, message) => {
    setBusy(what);
    try {
      await fn();
      refreshInbox();
      onDone(message);
    } catch (err) {
      onError(err.response?.data?.error || `Could not ${what} the ${lower}`);
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    const ok = await confirm(
      withdrawing
        ? `Withdraw ${row.name}? It is deleted and no longer waits for approval.`
        : `Delete ${row.name}? This can't be undone. It is recorded in the audit log.`,
      { title: `${withdrawing ? 'Withdraw' : 'Delete'} ${lower}`, confirmLabel: withdrawing ? 'Withdraw' : 'Delete', danger: true }
    );
    if (ok) run('delete', () => staffClient.delete(`${BASE[entity]}/${row.id}`), `${word} ${withdrawing ? 'withdrawn' : 'deleted'}.`);
  };

  const small = { padding: '6px 12px', fontSize: 13 };
  return (
    <>
      {rights.canDelete(row) && (
        <Button variant="ghost" style={{ ...small, color: 'var(--color-danger)', marginRight: 'auto' }} loading={busy === 'delete'} loadingText="Deleting..." onClick={remove}
          disabled={Boolean(inUse)} title={inUse ? `It can't be deleted while it has ${inUse}` : undefined}>
          {withdrawing ? 'Withdraw' : 'Delete'}
        </Button>
      )}
      {rights.canEdit(row) && <Button variant="ghost" style={small} onClick={onEdit}>Edit</Button>}
      {rights.canDecide(row) && (
        <>
          <Button variant="ghost" style={{ ...small, color: 'var(--color-danger)' }} disabled={Boolean(busy)} onClick={() => setRejecting(true)}>Reject</Button>
          <Button style={small} loading={busy === 'approve'} loadingText="Approving..."
            onClick={() => run('approve', () => approveOrg(entity, row.id), `${word} approved.`)}>Approve</Button>
        </>
      )}
      {rejecting && (
        <ReasonDialog title={`Reject ${lower} — ${row.name}`} label="Reason" confirmLabel={`Reject ${lower}`} danger
          onClose={() => setRejecting(false)}
          onSubmit={async (reason) => {
            await rejectOrg(entity, row.id, reason);
            setRejecting(false);
            refreshInbox();
            onDone(`${word} rejected.`);
          }} />
      )}
    </>
  );
}

/** The short code and full name fields every Add / Edit form starts with. */
export function CodeAndName({ form, setForm, word, codeHint, nameLabel = 'Full name', namePlaceholder, codePlaceholder, showErrors }) {
  const error = showErrors ? codeError(form.code, word) : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 150px) minmax(0, 1fr)', gap: 12 }}>
      <TextField label="Short code" required value={form.code} maxLength={CODE_MAX} placeholder={codePlaceholder}
        error={error} hint={!error ? codeHint : undefined}
        onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
        onBlur={() => setForm((f) => ({ ...f, code: normalizeCode(f.code) }))} style={{ textTransform: 'uppercase' }} />
      <TextField label={nameLabel} required value={form.name} placeholder={namePlaceholder}
        onChange={(e) => setForm({ ...form, name: e.target.value })} />
    </div>
  );
}

/** Case-insensitive "every word matches somewhere" filter for the page search. */
export function matches(query, ...texts) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "2 waiting", or nothing. */
export const countLabel = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
