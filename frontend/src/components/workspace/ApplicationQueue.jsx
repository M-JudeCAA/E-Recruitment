import React, { useEffect, useState } from 'react';
import staffClient from '../../models/staffApiClient';
import Alert from '../Alert';
import Skeleton from '../Skeleton';
import PageControls from '../PageControls';
import StatusBadge from '../StatusBadge';
import ApplicationReviewCard from '../ApplicationReviewCard';
import { useGeneratedCvDownload } from '../../utils/useGeneratedCvDownload';
import { Panel, Table, SidePanel, formatDay } from './ui';

// Every application across every vacancy (GET /api/applications), filtered
// and paged on the server - the Applications view of the Candidates page.
// "Needs my action" narrows it to what the viewer's role can move on. A row
// opens the full application in a side panel; work on one vacancy's
// applicants happens on that vacancy's page.

const STATUS_OPTIONS = ['Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn'];
const PAGE_SIZE = 25;
const STATUS_WORDS = { UnderReview: 'Under review', ShortlistProposed: 'Shortlist proposed', InterviewScheduled: 'Interview scheduled' };

export default function ApplicationQueue({ staffRole }) {
  const [status, setStatus] = useState('');
  const [screening, setScreening] = useState('all');
  const [department, setDepartment] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('newest');
  const [needsAction, setNeedsAction] = useState(false);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [departments, setDepartments] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const { download, hiddenPrintArea, downloadingId } = useGeneratedCvDownload();

  useEffect(() => { staffClient.get('/api/departments/approved').then((r) => setDepartments(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(input.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [input]);

  const load = () => {
    const params = { page, limit: PAGE_SIZE, sort };
    if (needsAction) params.needsAction = 'true';
    else {
      if (status) params.status = status;
      if (screening === 'flagged') params.screeningPassed = 'false';
      if (screening === 'passed') params.screeningPassed = 'true';
    }
    if (type) params.candidateType = type;
    if (department) params.departmentId = department;
    if (search) params.search = search;
    setError('');
    staffClient.get('/api/applications', { params })
      .then((res) => setResult(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load applications'));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [status, screening, department, type, sort, needsAction, search, page]);

  const set = (fn) => (e) => { fn(e.target.value); setPage(1); };
  const totalPages = result ? Math.max(Math.ceil(result.total / result.limit), 1) : 1;
  const open = result?.data.find((a) => a.id === openId);

  return (
    <>
      <div className="ws-toolbar">
        <input className="ws-field grow" placeholder="Candidate name or email" aria-label="Search applications" value={input} onChange={(e) => setInput(e.target.value)} />
        <select className="ws-field" aria-label="Status" value={status} onChange={set(setStatus)} disabled={needsAction}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_WORDS[s] || s}</option>)}
        </select>
        <select className="ws-field" aria-label="Screening" value={screening} onChange={set(setScreening)} disabled={needsAction}>
          <option value="all">Any screening result</option>
          <option value="flagged">Flagged</option>
          <option value="passed">Meets criteria</option>
        </select>
        <select className="ws-field" aria-label="Department" value={department} onChange={set(setDepartment)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="ws-field" aria-label="Candidate type" value={type} onChange={set(setType)}>
          <option value="">Internal and external</option>
          <option value="Internal">Internal</option>
          <option value="External">External</option>
        </select>
        <select className="ws-field" aria-label="Sort" value={sort} onChange={set(setSort)} disabled={needsAction}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score">Highest score</option>
          <option value="deadline">Vacancy deadline</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={needsAction} onChange={(e) => { setNeedsAction(e.target.checked); setPage(1); }} />
          Needs my action
        </label>
      </div>
      <Alert type="error" message={error} />
      <Panel padded={false}>
        {!result ? <div className="ws-panel-b">{[0, 1, 2].map((i) => <Skeleton key={i} height={14} width={`${70 - i * 10}%`} style={{ marginBottom: 12 }} />)}</div> : (
          <Table rows={result.data} getRowKey={(a) => a.id} onRowClick={(a) => setOpenId(a.id)} emptyText="No applications match these filters."
            columns={[
              { key: 'name', label: 'Candidate', render: (a) => <><span className="t">{a.candidate.fullName}</span><div className="s">{a.candidate.candidateType}</div></> },
              { key: 'vacancy', label: 'Vacancy', render: (a) => (a.vacancy ? <>{a.vacancy.title}<div className="s ws-mono">{a.vacancy.jobRef}</div></> : '—') },
              { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
              {
                key: 'screening', label: 'Screening', render: (a) => (a.screeningPassed === false
                  ? <span style={{ color: 'var(--color-warning)' }}>Flagged</span>
                  : a.screeningPassed === true ? <span className="s">Meets criteria</span> : <span className="s">—</span>)
              },
              { key: 'score', label: 'Score', align: 'right', className: 'ws-num', render: (a) => (a.shortlistScore != null ? a.shortlistScore.toFixed(1) : '—') },
              { key: 'submitted', label: 'Submitted', render: (a) => <span className="s">{a.submittedDate ? formatDay(a.submittedDate) : '—'}</span> }
            ]} />
        )}
      </Panel>
      {result && result.total > result.limit && (
        <PageControls page={page} totalPages={totalPages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
      )}
      {open && (
        <SidePanel wide title={open.candidate.fullName}
          eyebrow={open.vacancy ? <>{open.vacancy.title} · <span className="ws-mono">{open.vacancy.jobRef}</span></> : null}
          onClose={() => setOpenId(null)}>
          <ApplicationReviewCard app={open} vacancy={open.vacancy} staffRole={staffRole} onUpdated={load}
            onDownloadCv={download} downloadingId={downloadingId} showVacancyContext defaultExpanded />
        </SidePanel>
      )}
      {hiddenPrintArea}
    </>
  );
}
