import React, { useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useInbox, refreshInbox } from '../models/useInbox';
import HRSidebar from '../components/HRSidebar';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import PositionHeadcountCard from '../components/PositionHeadcountCard';
import OrgImportCard from '../components/OrgImportCard';
import ApproveNowBox from '../components/ApproveNowBox';
import Modal from '../components/Modal';
import ReasonDialog from '../components/ReasonDialog';
import { PageTop, Panel, Table, MenuButton, currentStaffId, formatDay } from '../components/workspace/ui';
import { useConfirm } from '../components/ConfirmDialog';
import { POSITION_LEVELS } from '../utils/positionLevels';
import { approveOrg, rejectOrg, ORG_WORD } from '../utils/orgApproval';

const emptyDeptForm = { name: '', directorateId: '' };
const emptyPositionForm = { name: '', departmentId: '', level: 1 };
const emptyDirectorateForm = { name: '', directorName: '', directorEmail: '' };

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK. Approving
// organisation changes and adding a directorate are Principal HR Officer+
// (own role, or acting under a delegation from one).
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
const LEVEL_NAMES = Object.fromEntries(POSITION_LEVELS.map((l) => [l.value, l.label]));

const HISTORY_SHOWN = 12;
const ORG_TASK_TYPES = { DirectorateApproval: 'directorate', DepartmentApproval: 'department', PositionApproval: 'position' };

// A waiting item's deadline, worded as the Inbox words it (inboxService.dueLabel).
function Due({ status }) {
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

export default function DepartmentAdmin() {
  const { staff } = useAuth();
  const inbox = useInbox({ enabled: Boolean(staff?.role) });
  const confirm = useConfirm();
  const me = currentStaffId();
  const rank = Math.max(ROLE_RANK[staff?.role] || 0, ROLE_RANK[inbox?.delegation?.actingFor?.role] || 0);
  const isReviewer = rank >= ROLE_RANK.Principal_HR_Officer;

  const [directorates, setDirectorates] = useState([]);
  const [approvedDepartments, setApprovedDepartments] = useState([]);
  const [pending, setPending] = useState({ directorates: [], departments: [], positions: [] });
  const [history, setHistory] = useState(null);
  const [deadlines, setDeadlines] = useState([]);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [loadingApproved, setLoadingApproved] = useState(true);
  const [loadingPending, setLoadingPending] = useState(true);

  const [deptForm, setDeptForm] = useState(emptyDeptForm);
  const [positionForm, setPositionForm] = useState(emptyPositionForm);
  const [directorateForm, setDirectorateForm] = useState(emptyDirectorateForm);
  const [autoApprove, setAutoApprove] = useState(true);
  const [adding, setAdding] = useState(null); // import | department | position | directorate
  const [rejecting, setRejecting] = useState(null); // { entity, id, name }

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // One busy flag per action, keyed by a descriptive string (e.g.
  // `approve-department-${id}`), since several pending items render their
  // own Approve/Reject buttons at once.
  const [busy, setBusy] = useState({});
  const isBusy = (key) => !!busy[key];
  const runBusy = async (key, fn) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const loadDirectorates = () => staffClient.get('/api/directorates')
    .then((res) => setDirectorates(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load directorates'));
  const loadApprovedDepartments = () => staffClient.get('/api/departments/approved')
    .then((res) => setApprovedDepartments(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load departments'))
    .finally(() => setLoadingApproved(false));
  const loadPending = () => Promise.all([
    staffClient.get('/api/directorates/pending'),
    staffClient.get('/api/departments/pending'),
    staffClient.get('/api/positions/pending')
  ]).then(([d, dep, p]) => setPending({ directorates: d.data, departments: dep.data, positions: p.data }))
    .catch((err) => setError(err.response?.data?.error || 'Could not load what is waiting for approval'))
    .finally(() => setLoadingPending(false));
  // Approval deadlines (backend slaStatusService): which waiting items are
  // due soon or overdue, the same figures the Inbox shows.
  const loadDeadlines = () => staffClient.get('/api/dashboard/follow-ups')
    .then((res) => setDeadlines(res.data.filter((t) => ORG_TASK_TYPES[t.taskType])))
    .catch(() => setDeadlines([]));
  const loadHistory = () => staffClient.get('/api/audit/organisation')
    .then((res) => setHistory(res.data))
    .catch(() => setHistory([]));

  const reloadAll = () => {
    loadDirectorates();
    loadApprovedDepartments();
    loadHistory();
    if (isReviewer) { loadPending(); loadDeadlines(); }
    refreshInbox();
  };

  useEffect(() => {
    loadDirectorates();
    loadApprovedDepartments();
    loadHistory();
    if (isReviewer) { loadPending(); loadDeadlines(); } else setLoadingPending(false);
  }, [isReviewer]);

  const openAdd = (kind) => { setAutoApprove(true); setAdding(kind); };
  const outcome = (word, data) => (data.autoApproved
    ? `${word} added and approved.`
    : `${word} added. It waits for ${isReviewer ? 'another ' : 'a '}Principal HR Officer or above to approve it before it can be used.`);

  const submitAdd = (key, url, form, reset, word, fallback) => async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    await runBusy(key, async () => {
      try {
        const res = await staffClient.post(url, { ...form, ...(isReviewer ? { autoApprove } : {}) });
        setMessage(outcome(word, res.data));
        reset();
        setAdding(null);
        reloadAll();
      } catch (err) {
        setError(err.response?.data?.error || fallback);
      }
    });
  };

  const approve = (entity, id) => runBusy(`approve-${entity}-${id}`, async () => {
    setError(''); setMessage('');
    try {
      const res = await approveOrg(entity, id);
      setMessage(entity === 'import' ? `Approved ${res.data.approved} item(s) from the import.` : `${ORG_WORD[entity]} approved.`);
      reloadAll();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve it');
    }
  });

  const approveImport = async (imp) => {
    if (!(await confirm(`Approve everything still waiting from ${imp.fileName} (${imp.summary})? It can then be used on vacancies.`,
      { title: 'Approve imported items', confirmLabel: 'Approve all' }))) return;
    approve('import', imp.id);
  };

  // Asked for in a ReasonDialog; the dialog shows any error itself.
  const reject = async (reason) => {
    await rejectOrg(rejecting.entity, rejecting.id, reason);
    setMessage(`${ORG_WORD[rejecting.entity]} rejected.`);
    setRejecting(null);
    reloadAll();
  };

  // Pending items: imports grouped (one entry per import), the rest one by one.
  const imports = new Map();
  const single = [];
  const addPending = (entity, row, what, by) => {
    if (row.import) {
      const entry = imports.get(row.import.id) || { ...row.import, counts: {} };
      entry.counts[entity] = (entry.counts[entity] || 0) + 1;
      imports.set(row.import.id, entry);
    } else {
      single.push({ entity, id: row.id, name: row.name, what, by, mine: row.createdById === me });
    }
  };
  pending.directorates.forEach((d) => addPending('directorate', d, <b>{d.name}</b>, d.createdBy?.name));
  pending.departments.forEach((d) => addPending('department', d, <b>{d.name} under {d.directorate.name}</b>, d.createdBy?.name));
  pending.positions.forEach((p) => addPending('position', p,
    <b>{p.name} ({LEVEL_NAMES[p.level] || p.level}) in {p.department.name}, {p.department.directorate.name}</b>, p.createdBy?.name));
  // Deadlines by item; an import's is its earliest-due item's.
  const deadlineOf = new Map(deadlines.map((t) => [`${ORG_TASK_TYPES[t.taskType]}-${t.taskId}`, t]));
  const importDeadline = (id) => deadlines.filter((t) => t.importId === id).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  const importList = [...imports.values()].map((imp) => ({
    ...imp,
    deadline: importDeadline(imp.id),
    mine: imp.createdById === me,
    summary: Object.entries(imp.counts).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ')
  }));
  const pendingCount = single.length + importList.length;

  const byDirectorate = Object.entries(approvedDepartments.reduce((groups, d) => {
    (groups[d.directorate.name] = groups[d.directorate.name] || []).push(d);
    return groups;
  }, {})).sort(([a], [b]) => a.localeCompare(b));
  const directorateFor = (name) => directorates.find((d) => d.name === name);
  const selectableDirectorates = directorates.filter((d) => d.status !== 'Rejected');
  const historyRows = (history || []).slice(0, showAllHistory ? undefined : HISTORY_SHOWN);

  const ownNote = <span className="ws-note">You added this - another Principal HR Officer or above approves it</span>;

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="organisation" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          title="Organisation"
          subtitle="Directorates, departments and positions, with approved headcount"
          actions={<>
            <Button variant="ghost" onClick={() => openAdd('import')}>Import</Button>
            <MenuButton label="+ Add" items={[
              { label: isReviewer ? 'Department' : 'Department (needs approval)', onClick: () => openAdd('department') },
              { label: isReviewer ? 'Position' : 'Position (needs approval)', onClick: () => openAdd('position') },
              isReviewer && { label: 'Directorate', onClick: () => openAdd('directorate') }
            ]} />
          </>}
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />

        {isReviewer && (loadingPending || pendingCount > 0) && (
          <section className="ws-group">
            <h3>Waiting for approval</h3>
            <div className="ws-panel">
              {loadingPending && <div className="ws-panel-b"><Skeleton width="50%" height={14} /></div>}
              {importList.map((imp) => (
                <div key={`imp-${imp.id}`} className="ws-task">
                  <div className="kind">Imported</div>
                  <div className="what">
                    <b>{imp.summary} from {imp.fileName}</b>
                    <div>{imp.createdBy?.name ? `Imported by ${imp.createdBy.name}` : 'Imported'} on {formatDay(imp.createdAt)} <Due status={imp.deadline} /></div>
                  </div>
                  <span />
                  {imp.mine ? ownNote : (
                    <Button style={{ padding: '5px 12px', fontSize: 13 }} loading={isBusy(`approve-import-${imp.id}`)} loadingText="Approving..."
                      onClick={() => approveImport(imp)}>Approve all</Button>
                  )}
                </div>
              ))}
              {single.map((item) => (
                <div key={`${item.entity}-${item.id}`} className="ws-task">
                  <div className="kind">{ORG_WORD[item.entity]} approval</div>
                  <div className="what">
                    {item.what}
                    <div>{item.by ? `Added by ${item.by}` : 'Added'} <Due status={deadlineOf.get(`${item.entity}-${item.id}`)} /></div>
                  </div>
                  {item.mine ? <><span />{ownNote}</> : (
                    <>
                      <Button variant="ghost" style={{ padding: '5px 12px', fontSize: 13, color: 'var(--color-danger)' }} disabled={isBusy(`approve-${item.entity}-${item.id}`)}
                        onClick={() => setRejecting(item)}>Reject</Button>
                      <Button style={{ padding: '5px 12px', fontSize: 13 }} loading={isBusy(`approve-${item.entity}-${item.id}`)} loadingText="Approving..."
                        onClick={() => approve(item.entity, item.id)}>Approve</Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <Panel padded={false} title="Directorates and departments">
          {loadingApproved ? (
            <div className="ws-panel-b">{[0, 1, 2].map((i) => <Skeleton key={i} width={`${70 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table
              rows={byDirectorate}
              getRowKey={([name]) => name}
              emptyText="No approved departments yet. Add one, or import the organogram from a spreadsheet."
              columns={[
                { key: 'dir', label: 'Directorate', render: ([name]) => <><span className="t">{name}</span>{directorateFor(name)?.directorName && <div className="s">{directorateFor(name).directorName}</div>}</> },
                { key: 'depts', label: 'Departments', render: ([, depts]) => <span className="s">{depts.map((d) => d.name).join(', ')}</span> },
                { key: 'n', label: 'Departments', align: 'right', className: 'ws-num', render: ([, depts]) => depts.length }
              ]}
            />
          )}
        </Panel>

        <PositionHeadcountCard departments={approvedDepartments} editable={isReviewer} />

        <Panel padded={false} title="Recent changes" note="Every addition, approval and rejection, from the audit log">
          {history === null ? (
            <div className="ws-panel-b"><Skeleton width="60%" height={14} /></div>
          ) : (
            <Table
              rows={historyRows}
              getRowKey={(r) => r.id}
              emptyText="No changes recorded yet."
              columns={[
                { key: 'when', label: 'When', render: (r) => <span className="s">{formatDay(r.timestamp)}</span> },
                { key: 'what', label: 'What', render: (r) => <><span className="t">{r.entityType === 'OrgImport' ? 'Import' : r.entityType} · {r.name || `#${r.entityId}`}</span>{r.comment && <div className="s">{r.comment}</div>}</> },
                { key: 'action', label: 'Action', render: (r) => r.action },
                { key: 'who', label: 'By', render: (r) => <span className="s">{r.performedBy?.name || 'System'}{r.actingAsId ? ' (delegated)' : ''}</span> }
              ]}
            />
          )}
          {history && history.length > HISTORY_SHOWN && (
            <div className="ws-panel-b">
              <Button variant="ghost" onClick={() => setShowAllHistory((v) => !v)}>{showAllHistory ? 'Show fewer' : `Show all ${history.length}`}</Button>
            </div>
          )}
        </Panel>
      </div>

      {adding === 'import' && (
        <Modal title="Import from a spreadsheet" onClose={() => setAdding(null)} maxWidth={760}
          footer={<Button variant="ghost" onClick={() => setAdding(null)}>Close</Button>}>
          <OrgImportCard canApprove={isReviewer} onImported={reloadAll} />
        </Modal>
      )}

      {adding === 'department' && (
        <Modal title="Add a department" onClose={() => setAdding(null)}>
          {!isReviewer && <p className="ws-note" style={{ marginTop: 0 }}>A Principal HR Officer approves a new department before it can be used on a vacancy.</p>}
          <form onSubmit={submitAdd('propose', '/api/departments', deptForm, () => setDeptForm(emptyDeptForm), 'Department', 'Could not add the department')}>
            <TextField label="Department name" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} required />
            <Select label="Directorate" value={deptForm.directorateId} onChange={(e) => setDeptForm({ ...deptForm, directorateId: e.target.value })} required>
              <option value="">Select a directorate</option>
              {selectableDirectorates.map((d) => <option key={d.id} value={d.id}>{d.name}{d.status === 'Pending' ? ' (awaiting approval)' : ''}</option>)}
            </Select>
            {isReviewer && <ApproveNowBox checked={autoApprove} onChange={setAutoApprove} what="department" />}
            <Button type="submit" loading={isBusy('propose')} loadingText="Adding...">Add department</Button>
          </form>
        </Modal>
      )}

      {adding === 'position' && (
        <Modal title="Add a position" onClose={() => setAdding(null)}>
          {!isReviewer && <p className="ws-note" style={{ marginTop: 0 }}>A Principal HR Officer approves a new position before it can be used on a vacancy.</p>}
          <form onSubmit={submitAdd('createPosition', '/api/positions', positionForm, () => setPositionForm(emptyPositionForm), 'Position', 'Could not add the position')}>
            <TextField label="Position name" value={positionForm.name} onChange={(e) => setPositionForm({ ...positionForm, name: e.target.value })} required />
            <Select label="Department" value={positionForm.departmentId} onChange={(e) => setPositionForm({ ...positionForm, departmentId: e.target.value })} required>
              <option value="">Select a department</option>
              {approvedDepartments.map((d) => <option key={d.id} value={d.id}>{d.directorate.name} — {d.name}</option>)}
            </Select>
            <Select label="Level" value={positionForm.level} onChange={(e) => setPositionForm({ ...positionForm, level: Number(e.target.value) })}>
              {POSITION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
            <p className="ws-note">From most junior (Officer) to most senior (Director). A vacancy's "Reports to" is chosen from more senior positions in the same department.</p>
            {isReviewer && <ApproveNowBox checked={autoApprove} onChange={setAutoApprove} what="position" />}
            <Button type="submit" loading={isBusy('createPosition')} loadingText="Adding...">Add position</Button>
          </form>
        </Modal>
      )}

      {adding === 'directorate' && (
        <Modal title="Add a directorate" onClose={() => setAdding(null)}>
          <p className="ws-note" style={{ marginTop: 0 }}>Directorates rarely change. Principal HR Officer and above.</p>
          <form onSubmit={submitAdd('createDirectorate', '/api/directorates', directorateForm, () => setDirectorateForm(emptyDirectorateForm), 'Directorate', 'Could not add the directorate')}>
            <TextField label="Directorate name" value={directorateForm.name} onChange={(e) => setDirectorateForm({ ...directorateForm, name: e.target.value })} required />
            <TextField label="Director's name (optional)" value={directorateForm.directorName} onChange={(e) => setDirectorateForm({ ...directorateForm, directorName: e.target.value })} />
            <TextField label="Director's email (optional)" value={directorateForm.directorEmail} onChange={(e) => setDirectorateForm({ ...directorateForm, directorEmail: e.target.value })} />
            <ApproveNowBox checked={autoApprove} onChange={setAutoApprove} what="directorate" />
            <Button type="submit" loading={isBusy('createDirectorate')} loadingText="Adding...">Add directorate</Button>
          </form>
        </Modal>
      )}

      {rejecting && (
        <ReasonDialog title={`Reject ${ORG_WORD[rejecting.entity].toLowerCase()} — ${rejecting.name}`} label="Reason"
          confirmLabel={`Reject ${ORG_WORD[rejecting.entity].toLowerCase()}`} danger
          onClose={() => setRejecting(null)} onSubmit={reject} />
      )}
    </div>
  );
}
