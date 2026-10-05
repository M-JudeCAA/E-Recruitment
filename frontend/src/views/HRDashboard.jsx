import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useDashboardEvents } from '../models/dashboardSocket';
import HRSidebar from '../components/HRSidebar';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import LiveIndicator from '../components/LiveIndicator';
import VacancyDraftsList from '../components/VacancyDraftsList';
import { PageTop, Panel, Table, Chips, Pill, formatDay } from '../components/workspace/ui';
import { debounce } from '../utils/debounce';
import { downloadCsv } from '../utils/csvDownload';

// Vacancies (/hr): every vacancy in one table, with the filters on one line.
// Stage and "Waiting on" come from each vacancy's progress (backend
// vacancyProgressService), so the list says where each one is and who has
// to act next. The chips double as quick filters. A row opens the vacancy's
// workspace (VacancyWorkspace.jsx), where every action on it lives.
// /hr?tab=offers - the old Offers tab - now goes to Offers & hires.

const STAGE_FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'approval', label: 'Pending approval', test: (v) => ['PendingApproval', 'Returned'].includes(v.status) },
  { key: 'advertised', label: 'Advertised', test: (v) => ['Open', 'PartiallyFilled'].includes(v.status) && v.progress?.stepIndex === 1 },
  { key: 'selection', label: 'In selection', test: (v) => ['Open', 'PartiallyFilled'].includes(v.status) && v.progress?.stepIndex >= 2 && v.progress?.stepIndex <= 5 },
  { key: 'offers', label: 'Offers', test: (v) => ['Open', 'PartiallyFilled'].includes(v.status) && v.progress?.stepIndex === 6 },
  { key: 'filled', label: 'Filled', test: (v) => v.status === 'Filled' },
  { key: 'closed', label: 'Closed', test: (v) => ['Closed', 'Rejected'].includes(v.status) }
];

export default function HRDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'offers') navigate('/hr/offers', { replace: true });
    if (tab === 'interviews') navigate('/hr/interviews', { replace: true });
  }, [searchParams, navigate]);

  const [vacancies, setVacancies] = useState(null);
  const [error, setError] = useState('');
  const [message] = useState(location.state?.vacancyCreatedMessage || '');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [directorate, setDirectorate] = useState(searchParams.get('directorate') || '');
  const [postingType, setPostingType] = useState(searchParams.get('postingType') || '');
  const [stage, setStage] = useState(searchParams.get('stage') || 'all');

  // Filters live in the URL, so a refresh or a shared link keeps the view.
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (directorate) next.set('directorate', directorate);
    if (postingType) next.set('postingType', postingType);
    if (stage !== 'all') next.set('stage', stage);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, directorate, postingType, stage]);

  const load = useCallback(() => staffClient.get('/api/vacancies/admin')
    .then((res) => setVacancies(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load vacancies')), []);
  useEffect(() => { load(); }, [load]);
  const refetch = useRef(debounce(() => load(), 500));
  const { connected } = useDashboardEvents(refetch.current);

  const list = vacancies || [];
  const directorates = [...new Set(list.map((v) => v.department?.directorate?.name).filter(Boolean))].sort();
  const base = list.filter((v) => {
    if (directorate && v.department?.directorate?.name !== directorate) return false;
    if (postingType && v.postingType !== postingType) return false;
    const words = q.trim().toLowerCase();
    if (words && !`${v.title} ${v.jobRef}`.toLowerCase().includes(words)) return false;
    return true;
  });
  const filter = STAGE_FILTERS.find((f) => f.key === stage) || STAGE_FILTERS[0];
  const rows = base.filter(filter.test);

  // The list as filtered on screen (no candidate data in it).
  const exportRows = () => downloadCsv(`vacancies-${new Date().toISOString().slice(0, 10)}.csv`, [
    { header: 'Job reference', value: (v) => v.jobRef },
    { header: 'Title', value: (v) => v.title },
    { header: 'Department', value: (v) => v.department?.name },
    { header: 'Directorate', value: (v) => v.department?.directorate?.name },
    { header: 'Posting', value: (v) => v.postingType },
    { header: 'Posts', value: (v) => v.positionsRequired },
    { header: 'Stage', value: (v) => v.progress?.stage?.label || v.status },
    { header: 'Applications close', value: (v) => (v.deadline ? v.deadline.slice(0, 10) : '') },
    { header: 'Applicants', value: (v) => v._count?.applications ?? 0 },
    { header: 'Waiting on', value: (v) => v.progress?.waitingOn || '' },
    { header: 'Raised', value: (v) => (v.createdAt ? v.createdAt.slice(0, 10) : '') },
    { header: 'Raised by', value: (v) => v.createdBy?.name }
  ], rows);

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="vacancies" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          title="Vacancies"
          subtitle="Every vacancy raised from an EXCO-approved requisition"
          actions={<>
            <LiveIndicator connected={connected} />
            <Button variant="ghost" disabled={!rows.length} onClick={exportRows}>Export</Button>
            <Button onClick={() => navigate('/hr/vacancies/new')}>+ New vacancy</Button>
          </>}
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
        <VacancyDraftsList />

        <div className="ws-toolbar">
          <input className="ws-field grow" placeholder="Title or job reference" aria-label="Filter vacancies" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="ws-field" aria-label="Directorate" value={directorate} onChange={(e) => setDirectorate(e.target.value)}>
            <option value="">All directorates</option>
            {directorates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="ws-field" aria-label="Posting type" value={postingType} onChange={(e) => setPostingType(e.target.value)}>
            <option value="">Internal and external</option>
            <option value="Internal">Internal</option>
            <option value="External">External</option>
          </select>
          <Chips style={{ marginLeft: 'auto' }} value={stage} onChange={setStage}
            options={STAGE_FILTERS.map((f) => ({ key: f.key, label: f.label, count: base.filter(f.test).length }))} />
        </div>

        <Panel padded={false}>
          {!vacancies ? (
            <div className="ws-panel-b">{[0, 1, 2, 3].map((i) => <Skeleton key={i} width={`${80 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table
              rows={rows}
              getRowKey={(v) => v.id}
              onRowClick={(v) => navigate(`/hr/vacancy/${v.id}`)}
              emptyText={list.length ? 'No vacancies match these filters.' : 'No vacancies yet. Start one from an EXCO-approved requisition with New vacancy.'}
              columns={[
                { key: 'ref', label: 'Job reference', className: 'ws-mono', render: (v) => v.jobRef.replace('UCAA/ADV/', '') },
                { key: 'title', label: 'Title', render: (v) => <span className="t">{v.title}</span> },
                { key: 'dept', label: 'Department', render: (v) => <>{v.department?.name}{v.department?.directorate?.name && <span className="s"> · {v.department.directorate.name}</span>}</> },
                { key: 'type', label: 'Posting', render: (v) => v.postingType },
                { key: 'stage', label: 'Stage', render: (v) => <Pill tone={v.progress?.stage?.tone}>{v.progress?.stage?.label || v.status}</Pill> },
                {
                  key: 'closes', label: 'Closes', className: 'ws-num', render: (v) => {
                    if (!v.deadline) return <span className="s">—</span>;
                    const passed = new Date(v.deadline) < new Date();
                    return passed ? <span className="s">Closed {formatDay(v.deadline)}</span> : formatDay(v.deadline);
                  }
                },
                { key: 'apps', label: 'Applicants', align: 'right', className: 'ws-num', render: (v) => v._count?.applications ?? 0 },
                { key: 'waiting', label: 'Waiting on', render: (v) => <span className="s">{v.progress?.waitingOn || '—'}</span> }
              ]}
            />
          )}
        </Panel>
        {vacancies && <div className="ws-note">{rows.length} of {list.length} vacancies</div>}
      </div>
    </div>
  );
}
