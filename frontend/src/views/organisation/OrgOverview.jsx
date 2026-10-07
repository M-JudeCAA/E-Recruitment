import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import staffClient from '../../models/staffApiClient';
import { refreshInbox } from '../../models/useInbox';
import HRSidebar from '../../components/HRSidebar';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import OrgImportCard from '../../components/OrgImportCard';
import Modal from '../../components/Modal';
import ReasonDialog from '../../components/ReasonDialog';
import { PageTop, Panel, Table, MenuButton, Figures, formatDay } from '../../components/workspace/ui';
import { useConfirm } from '../../components/ConfirmDialog';
import { levelLabel } from '../../utils/positionLevels';
import { approveOrg, rejectOrg, ORG_WORD } from '../../utils/orgApproval';
import { useOrgRights, useDeadlines, Due, countLabel } from './orgShared';

// Organisation (/hr/organisation): the overview of the structure - how many
// directorates, departments and positions there are, what is waiting for
// approval (approved here, one by one or a whole import at once), the
// spreadsheet import, and the recent changes from the audit log. Each level
// is managed on its own page (Directorates, Departments, Positions - under
// Organisation in the sidebar).

const HISTORY_SHOWN = 12;
const PAGE = { Directorate: 'directorates', Department: 'departments', Position: 'positions' };

export default function OrgOverview() {
  const rights = useOrgRights();
  const { isReviewer, me } = rights;
  const deadlines = useDeadlines(isReviewer);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [counts, setCounts] = useState(null);
  const [pending, setPending] = useState({ directorates: [], departments: [], positions: [] });
  const [loadingPending, setLoadingPending] = useState(true);
  const [history, setHistory] = useState(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [importing, setImporting] = useState(params.get('import') === '1');
  const [rejecting, setRejecting] = useState(null); // { entity, id, name }
  const [busy, setBusy] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadCounts = useCallback(() => Promise.all([
    staffClient.get('/api/directorates'), staffClient.get('/api/departments/admin'), staffClient.get('/api/positions/admin')
  ]).then(([d, dep, p]) => setCounts({ directorates: d.data, departments: dep.data, positions: p.data }))
    .catch((err) => setError(err.response?.data?.error || 'Could not load the organisation')), []);
  const loadPending = useCallback(() => {
    if (!isReviewer) { setLoadingPending(false); return Promise.resolve(); }
    return Promise.all([
      staffClient.get('/api/directorates/pending'), staffClient.get('/api/departments/pending'), staffClient.get('/api/positions/pending')
    ]).then(([d, dep, p]) => setPending({ directorates: d.data, departments: dep.data, positions: p.data }))
      .catch((err) => setError(err.response?.data?.error || 'Could not load what is waiting for approval'))
      .finally(() => setLoadingPending(false));
  }, [isReviewer]);
  const loadHistory = useCallback(() => staffClient.get('/api/audit/organisation')
    .then((res) => setHistory(res.data)).catch(() => setHistory([])), []);

  const reloadAll = () => { loadCounts(); loadPending(); loadHistory(); deadlines.reload(); refreshInbox(); };
  useEffect(() => { loadCounts(); loadHistory(); }, [loadCounts, loadHistory]);
  useEffect(() => { loadPending(); }, [loadPending]);

  const closeImport = () => {
    setImporting(false);
    if (params.get('import')) setParams({}, { replace: true });
  };

  const runBusy = async (key, fn) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try { await fn(); } finally { setBusy((b) => ({ ...b, [key]: false })); }
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
  pending.directorates.forEach((d) => addPending('directorate', d, <b>{d.name} ({d.code})</b>, d.createdBy?.name));
  pending.departments.forEach((d) => addPending('department', d, <b>{d.name} ({d.code}) under {d.directorate.code}</b>, d.createdBy?.name));
  pending.positions.forEach((p) => addPending('position', p,
    <b>{p.name}{p.code ? ` (${p.code})` : ''}, {levelLabel(p.level)} in {p.department.name}, {p.department.directorate.code}</b>, p.createdBy?.name));
  const importList = [...imports.values()].map((imp) => ({
    ...imp,
    deadline: deadlines.importDeadline(imp.id),
    mine: imp.createdById === me,
    summary: Object.entries(imp.counts).map(([k, n]) => countLabel(n, k)).join(', ')
  }));
  const pendingCount = single.length + importList.length;
  const ownNote = <span className="ws-note">You added this - another Principal HR Officer or above approves it</span>;

  const tally = (list) => ({
    approved: list.filter((r) => r.status === 'Approved').length,
    pending: list.filter((r) => r.status === 'Pending').length,
    rejected: list.filter((r) => r.status === 'Rejected').length
  });
  const levels = counts ? [
    { key: 'directorates', label: 'Directorates', list: counts.directorates, hint: 'The top level, each with its director' },
    { key: 'departments', label: 'Departments', list: counts.departments, hint: 'Under their directorates, with their staff and vacancies' },
    { key: 'positions', label: 'Positions', list: counts.positions, hint: 'Jobs in each department, with level and approved headcount' }
  ] : [];
  const noCode = counts ? counts.positions.filter((p) => !p.code && p.status !== 'Rejected').length : 0;
  const historyRows = (history || []).slice(0, showAllHistory ? undefined : HISTORY_SHOWN);

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="organisation" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          title="Organisation"
          subtitle="Directorates, departments and positions - what is waiting for approval, imports and recent changes"
          actions={<>
            <Button variant="ghost" onClick={() => setImporting(true)}>Import</Button>
            <MenuButton label="+ Add" items={[
              isReviewer && { label: 'Directorate', onClick: () => navigate('/hr/organisation/directorates?add=1') },
              { label: isReviewer ? 'Department' : 'Department (needs approval)', onClick: () => navigate('/hr/organisation/departments?add=1') },
              { label: isReviewer ? 'Position' : 'Position (needs approval)', onClick: () => navigate('/hr/organisation/positions?add=1') }
            ]} />
          </>}
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />

        {counts ? (
          <Figures figures={[
            { label: 'Directorates', value: tally(counts.directorates).approved },
            { label: 'Departments', value: tally(counts.departments).approved },
            { label: 'Positions', value: tally(counts.positions).approved },
            { label: 'Waiting for approval', value: levels.reduce((n, l) => n + tally(l.list).pending, 0) }
          ]} />
        ) : <Skeleton width="60%" height={40} />}

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
                    <Button style={{ padding: '5px 12px', fontSize: 13 }} loading={busy[`approve-import-${imp.id}`]} loadingText="Approving..."
                      onClick={() => approveImport(imp)}>Approve all</Button>
                  )}
                </div>
              ))}
              {single.map((item) => (
                <div key={`${item.entity}-${item.id}`} className="ws-task">
                  <div className="kind">{ORG_WORD[item.entity]} approval</div>
                  <div className="what">
                    <Link to={`/hr/organisation/${item.entity}s?open=${item.id}`} style={{ color: 'inherit' }}>{item.what}</Link>
                    <div>{item.by ? `Added by ${item.by}` : 'Added'} <Due status={deadlines.deadlineOf(item.entity, item.id)} /></div>
                  </div>
                  {item.mine ? <><span />{ownNote}</> : (
                    <>
                      <Button variant="ghost" style={{ padding: '5px 12px', fontSize: 13, color: 'var(--color-danger)' }} disabled={busy[`approve-${item.entity}-${item.id}`]}
                        onClick={() => setRejecting(item)}>Reject</Button>
                      <Button style={{ padding: '5px 12px', fontSize: 13 }} loading={busy[`approve-${item.entity}-${item.id}`]} loadingText="Approving..."
                        onClick={() => approve(item.entity, item.id)}>Approve</Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <Panel padded={false} title="Structure" note="Open a level to search, add, edit, approve or delete">
          {!counts ? (
            <div className="ws-panel-b"><Skeleton width="50%" height={14} /></div>
          ) : (
            <Table
              rows={levels}
              getRowKey={(l) => l.key}
              onRowClick={(l) => navigate(`/hr/organisation/${l.key}`)}
              columns={[
                { key: 'label', label: 'Level', render: (l) => <><span className="t">{l.label}</span><div className="s">{l.hint}</div></> },
                { key: 'approved', label: 'Approved', align: 'right', className: 'ws-num', render: (l) => tally(l.list).approved },
                { key: 'pending', label: 'Waiting', align: 'right', className: 'ws-num', render: (l) => tally(l.list).pending },
                { key: 'rejected', label: 'Rejected', align: 'right', className: 'ws-num', render: (l) => tally(l.list).rejected },
                { key: 'go', label: '', align: 'right', render: (l) => <Link to={`/hr/organisation/${l.key}`} onClick={(e) => e.stopPropagation()}>Manage</Link> }
              ]}
            />
          )}
        </Panel>
        {noCode > 0 && (
          <Alert type="info" message={<>{countLabel(noCode, 'position')} {noCode === 1 ? 'has' : 'have'} no short code yet (added before codes). <Link to="/hr/organisation/positions?status=nocode">Give them one</Link>.</>} />
        )}

        <Panel padded={false} title="Recent changes" note="Every addition, approval, edit and deletion, from the audit log">
          {history === null ? (
            <div className="ws-panel-b"><Skeleton width="60%" height={14} /></div>
          ) : (
            <Table
              rows={historyRows}
              getRowKey={(r) => r.id}
              emptyText="No changes recorded yet."
              columns={[
                { key: 'when', label: 'When', render: (r) => <span className="s">{formatDay(r.timestamp)}</span> },
                {
                  key: 'what', label: 'What', render: (r) => {
                    const label = `${r.entityType === 'OrgImport' ? 'Import' : r.entityType} · ${r.name || `#${r.entityId}`}${r.code ? ` (${r.code})` : ''}`;
                    const page = PAGE[r.entityType];
                    return (
                      <>
                        {page && !['Deleted', 'Withdrawn'].includes(r.action)
                          ? <Link className="t" to={`/hr/organisation/${page}?open=${r.entityId}`}>{label}</Link>
                          : <span className="t">{label}</span>}
                        {r.comment && <div className="s">{r.comment}</div>}
                      </>
                    );
                  }
                },
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

      {importing && (
        <Modal title="Import from a spreadsheet" onClose={closeImport} maxWidth={860}
          footer={<Button variant="ghost" onClick={closeImport}>Close</Button>}>
          <OrgImportCard canApprove={isReviewer} onImported={reloadAll} />
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
