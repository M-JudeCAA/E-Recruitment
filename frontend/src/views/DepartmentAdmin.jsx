import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import ViewSwitcher from '../components/ViewSwitcher';
import DataTable from '../components/DataTable';
import BoardView from '../components/BoardView';
import LoadMoreControl from '../components/LoadMoreControl';
import PositionHeadcountCard from '../components/PositionHeadcountCard';
import OrgImportCard from '../components/OrgImportCard';
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
  const [rejectReason, setRejectReason] = useState({});

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [urlParams, setUrlParams] = useSearchParams();
  const [view, setView] = useState(urlParams.get('view') || 'list');
  useEffect(() => {
    const next = new URLSearchParams(urlParams);
    if (view === 'list') next.delete('view'); else next.set('view', view);
    setUrlParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const PAGE_SIZE = 10;
  const [pendingVisibleCount, setPendingVisibleCount] = useState(PAGE_SIZE);
  const [approvedVisibleCount, setApprovedVisibleCount] = useState(PAGE_SIZE);

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

  const rejectDepartment = (id) => runBusy(`reject-${id}`, async () => {
    setError('');
    const reason = rejectReason[id];
    if (!reason || !reason.trim()) { setError('A rejection reason is required'); return; }
    try {
      await staffClient.patch(`/api/departments/${id}/reject`, { reason });
      loadPending();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reject department');
    }
  });

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

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="departments" />

        <div style={{ flex: 1, minWidth: 0 }}>
      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <OrgImportCard onImported={() => { loadDirectorates(); loadApprovedDepartments(); if (isReviewer) loadPending(); }} />

      <Card accent="var(--color-primary)">
        <h3 style={{ marginTop: 0 }}>Propose a department</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          New departments need Principal HR Officer approval before they can be used on a vacancy - unlike
          positions, which any HR Officer can add directly.
        </p>
        <form onSubmit={proposeDepartment}>
          <TextField label="Department name" value={deptForm.name}
            onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} required />
          <Select label="Directorate" value={deptForm.directorateId}
            onChange={(e) => setDeptForm({ ...deptForm, directorateId: e.target.value })} required>
            <option value="">Select a directorate</option>
            {directorates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Button type="submit" loading={isBusy('propose')} loadingText="Proposing...">Propose department</Button>
        </form>
      </Card>

      <Card accent="var(--color-accent)">
        <h3 style={{ marginTop: 0 }}>Add a position</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No approval workflow, unlike departments - any HR Officer can add a position directly to an
          approved department.
        </p>
        <form onSubmit={createPosition}>
          <TextField label="Position name" value={positionForm.name}
            onChange={(e) => setPositionForm({ ...positionForm, name: e.target.value })} required />
          <Select label="Department" value={positionForm.departmentId}
            onChange={(e) => setPositionForm({ ...positionForm, departmentId: e.target.value })} required>
            <option value="">Select a department</option>
            {approvedDepartments.map((d) => (
              <option key={d.id} value={d.id}>{d.directorate.name} &mdash; {d.name}</option>
            ))}
          </Select>
          <Select label="Level" value={positionForm.level}
            onChange={(e) => setPositionForm({ ...positionForm, level: Number(e.target.value) })}>
            {POSITION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </Select>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            From most junior (Officer) to most senior (Director). A vacancy's "Reports to" is chosen from more senior
            positions in the same department.
          </p>
          <Button type="submit" loading={isBusy('createPosition')} loadingText="Adding...">Add position</Button>
        </form>
      </Card>

      <PositionHeadcountCard departments={approvedDepartments} editable={isReviewer} />

      {isReviewer && (
        <Card accent="var(--color-border)" style={{ background: 'var(--color-bg-subtle)' }}>
          <h3 style={{ marginTop: 0 }}>Add a directorate</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Directorates are foundational and rarely change, unlike departments - restricted to Principal
            HR Officer and above.
          </p>
          <form onSubmit={createDirectorate}>
            <TextField label="Directorate name" value={directorateForm.name}
              onChange={(e) => setDirectorateForm({ ...directorateForm, name: e.target.value })} required />
            <TextField label="Director's name (optional)" value={directorateForm.directorName}
              onChange={(e) => setDirectorateForm({ ...directorateForm, directorName: e.target.value })} />
            <TextField label="Director's email (optional)" value={directorateForm.directorEmail}
              onChange={(e) => setDirectorateForm({ ...directorateForm, directorEmail: e.target.value })} />
            <Button type="submit" loading={isBusy('createDirectorate')} loadingText="Adding...">Add directorate</Button>
          </form>
        </Card>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <ViewSwitcher view={view} onChange={setView} />
      </div>

      {isReviewer && (
        <>
          <h3>Pending departments</h3>
          {pendingImports.map((imp) => (
            <Card key={imp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'var(--color-bg-subtle)' }}>
              <span style={{ fontSize: 14, minWidth: 0 }}>
                <strong>{imp.count} department(s)</strong> from the import of <strong style={{ overflowWrap: 'anywhere' }}>{imp.fileName}</strong>
                {imp.createdBy?.name && <> by {imp.createdBy.name}</>} on {new Date(imp.createdAt).toLocaleDateString()}
              </span>
              <Button style={{ padding: '4px 12px' }} loading={isBusy(`approve-import-${imp.id}`)} loadingText="Approving..."
                onClick={() => approveImport(imp, imp.count)}>Approve all {imp.count}</Button>
            </Card>
          ))}
          {loadingPending ? (
            [0, 1].map((i) => (
              <Card key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Skeleton width="45%" height={16} />
                  <Skeleton width={70} height={18} radius={999} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Skeleton width={80} height={26} radius={6} />
                  <Skeleton width="100%" height={26} radius={6} style={{ flex: 1 }} />
                  <Skeleton width={70} height={26} radius={6} />
                </div>
              </Card>
            ))
          ) : pendingDepartments.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No departments awaiting approval.</p>
          ) : view === 'table' ? (
            <>
              <Card style={{ padding: 0 }}>
                <DataTable
                  getRowKey={(d) => d.id}
                  rows={pendingDepartments.slice(0, pendingVisibleCount)}
                  columns={[
                    { key: 'name', label: 'Department', render: (d) => <span style={{ fontWeight: 600 }}>{d.directorate.name} — {d.name}</span> },
                    { key: 'by', label: 'Proposed by', render: (d) => d.createdBy?.name || '—' },
                    {
                      key: 'actions', label: '', align: 'right', render: (d) => (
                        <Button style={{ padding: '2px 8px', fontSize: 12 }} disabled={isBusy(`reject-${d.id}`)}
                          loading={isBusy(`approve-${d.id}`)} loadingText="…" onClick={() => approveDepartment(d.id)}>Approve</Button>
                      )
                    }
                  ]}
                />
              </Card>
              <LoadMoreControl total={pendingDepartments.length} visibleCount={pendingVisibleCount} onLoadMore={() => setPendingVisibleCount((c) => c + PAGE_SIZE)} />
            </>
          ) : view === 'board' ? (
            <>
              {/* Grouped by directorate, not status - every card here is
                  already PendingApproval, so a status board would be one
                  crowded column. Directorate is the dimension that varies. */}
              <BoardView
                getItemKey={(d) => d.id}
                items={pendingDepartments.slice(0, pendingVisibleCount)}
                groupBy={(d) => d.directorate.name}
                columns={[...new Set(pendingDepartments.map((d) => d.directorate.name))].map((name) => ({ key: name, label: name }))}
                renderCard={(d) => (
                  <Card style={{ marginBottom: 0, padding: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
                    {d.createdBy?.name && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>proposed by {d.createdBy.name}</div>}
                    <Button style={{ marginTop: 6, padding: '2px 8px', fontSize: 11 }} disabled={isBusy(`reject-${d.id}`)}
                      loading={isBusy(`approve-${d.id}`)} loadingText="…" onClick={() => approveDepartment(d.id)}>Approve</Button>
                  </Card>
                )}
              />
              <LoadMoreControl total={pendingDepartments.length} visibleCount={pendingVisibleCount} onLoadMore={() => setPendingVisibleCount((c) => c + PAGE_SIZE)} />
            </>
          ) : (
            <>
              {pendingDepartments.slice(0, pendingVisibleCount).map((d) => (
                <Card key={d.id}>
                  <strong>{d.directorate.name} &mdash; {d.name}</strong> <StatusBadge status={d.status} />
                  {d.createdBy?.name && <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>proposed by {d.createdBy.name}{d.import ? ` (import of ${d.import.fileName})` : ''}</span>}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Button style={{ padding: '2px 10px' }} disabled={isBusy(`reject-${d.id}`)}
                      loading={isBusy(`approve-${d.id}`)} loadingText="Approving..." onClick={() => approveDepartment(d.id)}>Approve</Button>
                    <input
                      placeholder="Rejection reason"
                      value={rejectReason[d.id] || ''}
                      onChange={(e) => setRejectReason({ ...rejectReason, [d.id]: e.target.value })}
                      style={{ flex: 1, padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                    />
                    <Button variant="ghost" style={{ padding: '2px 10px', color: 'var(--color-danger)' }} disabled={isBusy(`approve-${d.id}`)}
                      loading={isBusy(`reject-${d.id}`)} loadingText="Rejecting..." onClick={() => rejectDepartment(d.id)}>Reject</Button>
                  </div>
                </Card>
              ))}
              <LoadMoreControl total={pendingDepartments.length} visibleCount={pendingVisibleCount} onLoadMore={() => setPendingVisibleCount((c) => c + PAGE_SIZE)} />
            </>
          )}
        </>
      )}

      <h3>Approved departments</h3>
      {loadingApproved ? (
        [0, 1, 2].map((i) => (
          <Card key={i}>
            <Skeleton width="30%" height={16} style={{ marginBottom: 8 }} />
            <Skeleton width="70%" height={12} />
          </Card>
        ))
      ) : view === 'table' ? (
        <>
          <Card style={{ padding: 0 }}>
            <DataTable
              getRowKey={(d) => d.id}
              rows={approvedDepartments.slice(0, approvedVisibleCount)}
              columns={[
                { key: 'directorate', label: 'Directorate', render: (d) => d.directorate.name },
                { key: 'name', label: 'Department', render: (d) => <span style={{ fontWeight: 600 }}>{d.name}</span> }
              ]}
            />
          </Card>
          <LoadMoreControl total={approvedDepartments.length} visibleCount={approvedVisibleCount} onLoadMore={() => setApprovedVisibleCount((c) => c + PAGE_SIZE)} />
        </>
      ) : view === 'board' ? (
        <BoardView
          getItemKey={(d) => d.id}
          items={approvedDepartments}
          groupBy={(d) => d.directorate.name}
          columns={[...new Set(approvedDepartments.map((d) => d.directorate.name))].sort().map((name) => ({ key: name, label: name }))}
          renderCard={(d) => (
            <Card style={{ marginBottom: 0, padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
            </Card>
          )}
        />
      ) : (
        Object.entries(
          approvedDepartments.reduce((groups, d) => {
            const key = d.directorate.name;
            (groups[key] = groups[key] || []).push(d);
            return groups;
          }, {})
        ).map(([directorateName, depts]) => (
          <Card key={directorateName}>
            <strong>{directorateName}</strong>
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
              {depts.map((d) => d.name).join(', ')}
            </div>
          </Card>
        ))
      )}
        </div>
      </div>
    </div>
  );
}
