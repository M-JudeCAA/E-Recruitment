import React, { useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import PositionHeadcountCard from '../components/PositionHeadcountCard';
import OrgImportCard from '../components/OrgImportCard';
import Modal from '../components/Modal';
import ReasonDialog from '../components/ReasonDialog';
import { PageTop, Panel, Table, MenuButton } from '../components/workspace/ui';
import { useConfirm } from '../components/ConfirmDialog';
import { POSITION_LEVELS } from '../utils/positionLevels';

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
  const confirm = useConfirm();
  const isReviewer = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  const [directorates, setDirectorates] = useState([]);
  const [approvedDepartments, setApprovedDepartments] = useState([]);
  const [pendingDepartments, setPendingDepartments] = useState([]);
  const [loadingApproved, setLoadingApproved] = useState(true);
  const [loadingPending, setLoadingPending] = useState(true);

  const [deptForm, setDeptForm] = useState(emptyDeptForm);
  const [positionForm, setPositionForm] = useState(emptyPositionForm);
  const [directorateForm, setDirectorateForm] = useState(emptyDirectorateForm);
  const [adding, setAdding] = useState(null); // import | department | position | directorate
  const [rejecting, setRejecting] = useState(null);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // One busy flag per action, keyed by a descriptive string (e.g.
  // `approve-${id}`) - same pattern as ProfileStep.jsx's education/work
  // experience CRUD, needed here since multiple pending-department cards
  // render their own Approve/Reject actions at once, not just one at a time.
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
  const loadPending = () => staffClient.get('/api/departments/pending')
    .then((res) => setPendingDepartments(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load pending departments'))
    .finally(() => setLoadingPending(false));

  useEffect(() => {
    loadDirectorates();
    loadApprovedDepartments();
    if (isReviewer) loadPending();
    else setLoadingPending(false);
  }, [isReviewer]);

  const proposeDepartment = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    await runBusy('propose', async () => {
      try {
        await staffClient.post('/api/departments', deptForm);
        setMessage('Department proposed. It needs Principal HR Officer approval before it can be used on a vacancy.');
        setDeptForm(emptyDeptForm);
        loadApprovedDepartments();
        if (isReviewer) loadPending();
      } catch (err) {
        setError(err.response?.data?.error || 'Could not propose department');
      }
    });
  };

  const createDirectorate = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    await runBusy('createDirectorate', async () => {
      try {
        await staffClient.post('/api/directorates', directorateForm);
        setMessage('Directorate created.');
        setDirectorateForm(emptyDirectorateForm);
        loadDirectorates();
      } catch (err) {
        setError(err.response?.data?.error || 'Could not create directorate');
      }
    });
  };

  const approveDepartment = (id) => runBusy(`approve-${id}`, async () => {
    setError('');
    try {
      await staffClient.patch(`/api/departments/${id}/approve`);
      loadPending();
      loadApprovedDepartments();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve department');
    }
  });

  const approveImport = async (imp, count) => {
    if (!(await confirm(`Approve all ${count} pending department(s) from ${imp.fileName}? Their positions can then be used on vacancies.`,
      { title: 'Approve imported departments', confirmLabel: `Approve ${count}` }))) return;
    await approveImportNow(imp);
  };
  const approveImportNow = (imp) => runBusy(`approve-import-${imp.id}`, async () => {
    setError(''); setMessage('');
    try {
      const res = await staffClient.patch(`/api/departments/imports/${imp.id}/approve`);
      setMessage(`Approved ${res.data.approved} department(s) from ${imp.fileName}.`);
      loadPending();
      loadApprovedDepartments();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve the departments');
    }
  });

  // Pending departments that came from a batch import, one entry per import.
  const pendingImports = [...pendingDepartments.reduce((map, d) => {
    if (d.import) map.set(d.import.id, { ...d.import, count: (map.get(d.import.id)?.count || 0) + 1 });
    return map;
  }, new Map()).values()];

  // Asked for in a ReasonDialog; the dialog shows any error itself.
  const rejectDepartment = async (reason) => {
    await staffClient.patch(`/api/departments/${rejecting.id}/reject`, { reason });
    setRejecting(null);
    setMessage('Department rejected.');
    loadPending();
  };

  const createPosition = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    await runBusy('createPosition', async () => {
      try {
        await staffClient.post('/api/positions', positionForm);
        setMessage('Position added.');
        setPositionForm(emptyPositionForm);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not add position');
      }
    });
  };

  const byDirectorate = Object.entries(approvedDepartments.reduce((groups, d) => {
    (groups[d.directorate.name] = groups[d.directorate.name] || []).push(d);
    return groups;
  }, {})).sort(([a], [b]) => a.localeCompare(b));
  const directorateFor = (name) => directorates.find((d) => d.name === name);

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="organisation" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          title="Organisation"
          subtitle="Directorates, departments and positions, with approved headcount"
          actions={<>
            <Button variant="ghost" onClick={() => setAdding('import')}>Import</Button>
            <MenuButton label="+ Add" items={[
              { label: 'Department (needs approval)', onClick: () => setAdding('department') },
              { label: 'Position', onClick: () => setAdding('position') },
              isReviewer && { label: 'Directorate', onClick: () => setAdding('directorate') }
            ]} />
          </>}
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />

        {isReviewer && (loadingPending || pendingDepartments.length > 0) && (
          <section className="ws-group">
            <h3>Waiting for approval</h3>
            <div className="ws-panel">
              {loadingPending && <div className="ws-panel-b"><Skeleton width="50%" height={14} /></div>}
              {pendingImports.map((imp) => (
                <div key={`imp-${imp.id}`} className="ws-task">
                  <div className="kind">Imported departments</div>
                  <div className="what">
                    <b>{imp.count} department{imp.count === 1 ? '' : 's'} from {imp.fileName}</b>
                    <div>{imp.createdBy?.name ? `Imported by ${imp.createdBy.name}` : 'Imported'} on {new Date(imp.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  </div>
                  <span />
                  <Button style={{ padding: '5px 12px', fontSize: 13 }} loading={isBusy(`approve-import-${imp.id}`)} loadingText="Approving..."
                    onClick={() => approveImport(imp, imp.count)}>Approve all {imp.count}</Button>
                </div>
              ))}
              {pendingDepartments.filter((d) => !d.import).map((d) => (
                <div key={d.id} className="ws-task">
                  <div className="kind">Department approval</div>
                  <div className="what">
                    <b>{d.name} under {d.directorate.name}</b>
                    <div>{d.createdBy?.name ? `Proposed by ${d.createdBy.name}` : 'Proposed'}</div>
                  </div>
                  <Button variant="ghost" style={{ padding: '5px 12px', fontSize: 13, color: 'var(--color-danger)' }} disabled={isBusy(`approve-${d.id}`)}
                    onClick={() => setRejecting(d)}>Reject</Button>
                  <Button style={{ padding: '5px 12px', fontSize: 13 }} loading={isBusy(`approve-${d.id}`)} loadingText="Approving..."
                    onClick={() => approveDepartment(d.id)}>Approve</Button>
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
      </div>

      {adding === 'import' && (
        <Modal title="Import from a spreadsheet" onClose={() => setAdding(null)} maxWidth={760}
          footer={<Button variant="ghost" onClick={() => setAdding(null)}>Close</Button>}>
          <OrgImportCard onImported={() => { loadDirectorates(); loadApprovedDepartments(); if (isReviewer) loadPending(); }} />
        </Modal>
      )}

      {adding === 'department' && (
        <Modal title="Propose a department" onClose={() => setAdding(null)}>
          <p className="ws-note" style={{ marginTop: 0 }}>A Principal HR Officer approves a new department before it can be used on a vacancy.</p>
          <form onSubmit={async (e) => { await proposeDepartment(e); setAdding(null); }}>
            <TextField label="Department name" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} required />
            <Select label="Directorate" value={deptForm.directorateId} onChange={(e) => setDeptForm({ ...deptForm, directorateId: e.target.value })} required>
              <option value="">Select a directorate</option>
              {directorates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Button type="submit" loading={isBusy('propose')} loadingText="Proposing...">Propose department</Button>
          </form>
        </Modal>
      )}

      {adding === 'position' && (
        <Modal title="Add a position" onClose={() => setAdding(null)}>
          <p className="ws-note" style={{ marginTop: 0 }}>Any HR Officer can add a position to an approved department.</p>
          <form onSubmit={async (e) => { await createPosition(e); setAdding(null); }}>
            <TextField label="Position name" value={positionForm.name} onChange={(e) => setPositionForm({ ...positionForm, name: e.target.value })} required />
            <Select label="Department" value={positionForm.departmentId} onChange={(e) => setPositionForm({ ...positionForm, departmentId: e.target.value })} required>
              <option value="">Select a department</option>
              {approvedDepartments.map((d) => <option key={d.id} value={d.id}>{d.directorate.name} — {d.name}</option>)}
            </Select>
            <Select label="Level" value={positionForm.level} onChange={(e) => setPositionForm({ ...positionForm, level: Number(e.target.value) })}>
              {POSITION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
            <p className="ws-note">From most junior (Officer) to most senior (Director). A vacancy's "Reports to" is chosen from more senior positions in the same department.</p>
            <Button type="submit" loading={isBusy('createPosition')} loadingText="Adding...">Add position</Button>
          </form>
        </Modal>
      )}

      {adding === 'directorate' && (
        <Modal title="Add a directorate" onClose={() => setAdding(null)}>
          <p className="ws-note" style={{ marginTop: 0 }}>Directorates rarely change. Principal HR Officer and above.</p>
          <form onSubmit={async (e) => { await createDirectorate(e); setAdding(null); }}>
            <TextField label="Directorate name" value={directorateForm.name} onChange={(e) => setDirectorateForm({ ...directorateForm, name: e.target.value })} required />
            <TextField label="Director's name (optional)" value={directorateForm.directorName} onChange={(e) => setDirectorateForm({ ...directorateForm, directorName: e.target.value })} />
            <TextField label="Director's email (optional)" value={directorateForm.directorEmail} onChange={(e) => setDirectorateForm({ ...directorateForm, directorEmail: e.target.value })} />
            <Button type="submit" loading={isBusy('createDirectorate')} loadingText="Adding...">Add directorate</Button>
          </form>
        </Modal>
      )}

      {rejecting && (
        <ReasonDialog title={`Reject department — ${rejecting.name}`} label="Reason" confirmLabel="Reject department" danger
          onClose={() => setRejecting(null)} onSubmit={rejectDepartment} />
      )}
    </div>
  );
}
