import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useDashboardEvents } from '../models/dashboardSocket';
import { refreshInbox } from '../models/useInbox';
import HRSidebar from '../components/HRSidebar';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import PageControls from '../components/PageControls';
import LiveIndicator from '../components/LiveIndicator';
import CsvDownloadButton from '../components/CsvDownloadButton';
import OfferSummary from '../components/offers/OfferSummary';
import OfferActions from '../components/offers/OfferActions';
import { formatSalary, deadlineInfo } from '../components/offers/offerFormat';
import { PageTop, Panel, Table, Chips, Pill, SidePanel, KeyValues, formatDay } from '../components/workspace/ui';
import { debounce } from '../utils/debounce';

// Offers & hires (/hr/offers): every offer across all vacancies in one
// table, filtered by where it stands, and the onboarding cases opened from
// accepted offers (Mark as Hired). A row opens the offer in a side panel
// with the actions the viewer can take (approve, return, revise, withdraw,
// mark as hired). The vacancy's own Merit list & offers tab shows the same
// offers for one vacancy.

const PAGE_SIZE = 25;
const FILTERS = [
  { key: '', label: 'All' },
  { key: 'Recommended', label: 'Awaiting approval' },
  { key: 'Returned', label: 'Returned' },
  { key: 'Approved', label: 'With candidate' },
  { key: 'expiring', label: 'Answer due in 3 days' },
  { key: 'Accepted', label: 'Accepted' },
  { key: 'hired', label: 'Hired' },
  { key: 'Declined', label: 'Declined' },
  { key: 'Expired', label: 'Expired' },
  { key: 'Withdrawn', label: 'Withdrawn' }
];
const TONES = { Recommended: 'warn', Returned: 'warn', Approved: 'brand', Extended: 'brand', Accepted: 'ok', Declined: 'bad', Expired: 'neutral', Withdrawn: 'neutral' };
const LABELS = { Recommended: 'Awaiting approval', Returned: 'Returned', Approved: 'With candidate', Extended: 'With candidate', Accepted: 'Accepted', Declined: 'Declined', Expired: 'Expired', Withdrawn: 'Withdrawn' };
const HANDOFF = { NotConfigured: ['Download the package', 'neutral'], Pending: ['Sending to HRIS', 'warn'], Sent: ['Sent to HRIS', 'ok'], Failed: ['HRIS hand-off failed', 'bad'] };

function nextFor(o) {
  if (o.status === 'Recommended') return o.recommendedDate ? `Recommended ${formatDay(o.recommendedDate)}` : 'Recommended';
  if (o.status === 'Returned') return o.returnReason ? `Returned: ${o.returnReason}` : 'Returned for revision';
  if (o.status === 'Approved' || o.status === 'Extended') {
    const info = deadlineInfo(o.responseDeadline);
    return o.responseDeadline ? <span style={{ color: info?.urgent ? 'var(--color-warning)' : undefined }}>Answer by {formatDay(o.responseDeadline)}{info ? ` · ${info.label}` : ''}</span> : 'With the candidate';
  }
  if (o.status === 'Accepted') return o.decidedAt ? `Accepted ${formatDay(o.decidedAt)}` : 'Accepted';
  return o.decidedAt ? formatDay(o.decidedAt) : '';
}

export default function OffersAndHires() {
  const { staff } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [hires, setHires] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    const params = { page, limit: PAGE_SIZE };
    if (filter === 'expiring') params.expiringSoon = 'true';
    else if (filter && filter !== 'hired') params.status = filter;
    staffClient.get('/api/applications/offers', { params })
      .then((res) => setResult(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load offers'));
    staffClient.get('/api/applications/hires').then((res) => setHires(res.data)).catch(() => setHires([]));
  }, [filter, page]);
  useEffect(() => { load(); }, [load]);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const refetch = useRef(debounce(() => loadRef.current(), 500));
  const { connected } = useDashboardEvents(refetch.current);

  const countFor = (key) => {
    if (key === 'hired') return hires?.length ?? null;
    if (!result) return null;
    if (key === '') return Object.values(result.counts || {}).reduce((a, b) => a + b, 0);
    if (key === 'expiring') return result.expiringSoon;
    return result.counts?.[key] || 0;
  };
  const totalPages = result ? Math.max(Math.ceil(result.total / PAGE_SIZE), 1) : 1;
  const openOffer = result?.data.find((o) => o.id === open);
  // The export follows the chip that is selected (access-logged on the server).
  const exportUrl = filter === 'hired' ? '/api/applications/hires/export'
    : filter === 'expiring' ? '/api/applications/offers/export?expiringSoon=true'
      : `/api/applications/offers/export${filter ? `?status=${filter}` : ''}`;

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="offers" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop title="Offers & hires" subtitle="Every offer across all vacancies, and the onboarding cases opened from them" actions={<>
            <LiveIndicator connected={connected} />
            <CsvDownloadButton label="Export" url={exportUrl} fallbackName={filter === 'hired' ? 'hires.csv' : 'offers.csv'} />
          </>} />
        <Alert type="error" message={error} />
        <Chips value={filter} onChange={(k) => { setFilter(k); setPage(1); }}
          options={FILTERS.map((f) => ({ key: f.key, label: f.label, count: countFor(f.key) }))} />

        {filter === 'hired' ? (
          <Panel padded={false}>
            {!hires ? <div className="ws-panel-b"><Skeleton height={14} width="60%" /></div> : (
              <Table rows={hires} getRowKey={(h) => h.id}
                onRowClick={(h) => navigate(`/hr/vacancy/${h.vacancyId}?tab=merit`)}
                emptyText="Nobody has been marked as hired yet. Mark an accepted offer as hired from the offer."
                columns={[
                  { key: 'case', label: 'Onboarding case', className: 'ws-mono', render: (h) => h.caseRef },
                  { key: 'name', label: 'Candidate', render: (h) => <span className="t">{h.candidateName}</span> },
                  { key: 'vacancy', label: 'Vacancy', render: (h) => <>{h.vacancy?.title}<div className="s ws-mono">{h.vacancy?.jobRef}</div></> },
                  { key: 'hired', label: 'Hired', render: (h) => <>{formatDay(h.hiredAt)}<div className="s">{h.hiredBy?.name}</div></> },
                  { key: 'handoff', label: 'Onboarding', render: (h) => { const [l, t] = HANDOFF[h.handoffStatus] || [h.handoffStatus, 'neutral']; return <Pill tone={t}>{l}</Pill>; } }
                ]} />
            )}
          </Panel>
        ) : (
          <Panel padded={false}>
            {!result ? <div className="ws-panel-b">{[0, 1, 2].map((i) => <Skeleton key={i} height={14} width={`${70 - i * 10}%`} style={{ marginBottom: 12 }} />)}</div> : (
              <Table rows={result.data} getRowKey={(o) => o.id} onRowClick={(o) => setOpen(o.id)}
                emptyText={filter ? 'No offers match this filter.' : 'No offers yet. Offers are recommended from a vacancy\'s approved merit list.'}
                columns={[
                  { key: 'name', label: 'Candidate', render: (o) => <><span className="t">{o.application.candidate.fullName}</span><div className="s">{o.application.candidate.candidateType}</div></> },
                  { key: 'vacancy', label: 'Vacancy', render: (o) => <>{o.application.vacancy.title}<div className="s">{o.application.meritRank ? `Merit list #${o.application.meritRank} ${o.application.meritListStatus || ''}` : o.application.vacancy.jobRef}</div></> },
                  { key: 'salary', label: 'Salary', className: 'ws-num', render: (o) => formatSalary(o) || '—' },
                  { key: 'status', label: 'Status', render: (o) => <Pill tone={TONES[o.status]}>{LABELS[o.status] || o.status}</Pill> },
                  { key: 'next', label: 'Next', render: (o) => <span className="s">{nextFor(o)}</span> }
                ]} />
            )}
          </Panel>
        )}
        {filter !== 'hired' && result && result.total > PAGE_SIZE && (
          <PageControls page={page} totalPages={totalPages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        )}
      </div>

      {openOffer && (
        <SidePanel title={openOffer.application.candidate.fullName}
          eyebrow={<>{openOffer.application.vacancy.title} · <span className="ws-mono">{openOffer.application.vacancy.jobRef}</span></>}
          badges={<Pill tone={TONES[openOffer.status]}>{LABELS[openOffer.status] || openOffer.status}</Pill>}
          onClose={() => setOpen(null)}>
          <KeyValues rows={[
            ['Merit list', openOffer.application.meritRank ? `#${openOffer.application.meritRank} ${openOffer.application.meritListStatus || ''}` : null],
            ['Posts', openOffer.application.vacancy.positionsRequired]
          ]} />
          <OfferSummary offer={openOffer} />
          <OfferActions offer={openOffer} applicationId={openOffer.application.id} staffRole={staff?.role} onChanged={() => { load(); refreshInbox(); }} />
          <div><Link to={`/hr/vacancy/${openOffer.application.vacancy.id}?tab=merit`}>Open the vacancy’s merit list</Link></div>
        </SidePanel>
      )}
    </div>
  );
}
