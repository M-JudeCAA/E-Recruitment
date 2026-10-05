import React, { useEffect, useMemo, useState } from 'react';
import { Mail, XCircle } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Button from '../Button';
import Alert from '../Alert';
import ReasonDialog from '../ReasonDialog';
import BulkEmailComposer from '../BulkEmailComposer';
import CsvDownloadButton from '../CsvDownloadButton';
import { TagChips } from '../TagEditor';
import { PIPELINE_COLUMNS, pipelineColumn } from './pipeline';
import { Panel, Table, Chips, Pill, rankOf, ROLE_RANK } from './ui';

// A vacancy's Applicants tab: everyone who applied, one row each, with the
// stage they are at (the same columns as the all-stages board,
// pipelineColumn), what the committee made of them, their interview score,
// merit list place and offer. Chips filter by stage; ticking rows offers
// bulk email and "Not progressing" (FR-ATS-050, the audited reject). A row
// opens the full application in a side panel (onOpen).

const STAGE_TONES = { applied: 'neutral', system: 'info', committee: 'info', exco: 'warn', interviews: 'info', offer: 'brand', onboarding: 'ok', closed: 'bad' };
const BAND_LABELS = { Unanimous: 'Qualified · unanimous', Majority: 'Qualified · majority', Disputed: 'Disputed', NotQualified: 'Not qualified' };
const BAND_TONES = { Unanimous: 'ok', Majority: 'info', Disputed: 'warn', NotQualified: 'bad' };
const OFFER_TONES = { Recommended: 'warn', Returned: 'warn', Approved: 'brand', Extended: 'brand', Accepted: 'ok', Declined: 'bad', Expired: 'neutral', Withdrawn: 'neutral' };
const OFFER_LABELS = { Recommended: 'Awaiting approval', Returned: 'Returned', Approved: 'With candidate', Extended: 'With candidate', Accepted: 'Accepted', Declined: 'Declined', Expired: 'Expired', Withdrawn: 'Withdrawn' };

function interviewScore(app) {
  const held = (app.interviewRounds || []).filter((r) => r.score != null);
  return held.length ? held[held.length - 1].score : null;
}

const rejectable = (a) => !['Draft', 'Offered', 'Rejected', 'Withdrawn'].includes(a.status);

export default function ApplicantsTable({ vacancy, applications, staffRole, onOpen, onUpdated }) {
  const canAct = rankOf(staffRole) >= ROLE_RANK.Senior_HR_Officer;
  const [committeeActive, setCommitteeActive] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [rejecting, setRejecting] = useState(null);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    staffClient.get(`/api/shortlist-committee/vacancies/${vacancy.id}`)
      .then((res) => setCommitteeActive(['Rating', 'Moderation', 'Closed'].includes(res.data.exercise?.status)))
      .catch(() => {});
  }, [vacancy.id, applications]);

  const column = (a) => pipelineColumn(a, committeeActive);
  const searched = useMemo(() => {
    const words = search.trim().toLowerCase();
    if (!words) return applications;
    return applications.filter((a) => [a.candidate.fullName, a.candidate.email, ...(a.candidate.tags || []).map((t) => (t.tag || t).name)]
      .some((v) => String(v || '').toLowerCase().includes(words)));
  }, [applications, search]);
  const rows = filter === 'all' ? searched : searched.filter((a) => column(a) === filter);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedApps = applications.filter((a) => selected.includes(a.id));

  const rejectAll = async (reason) => {
    const failures = [];
    for (const a of rejecting) {
      try {
        await staffClient.patch(`/api/applications/${a.id}/reject`, { reason });
      } catch (err) {
        failures.push(`${a.candidate.fullName}: ${err.response?.data?.error || 'failed'}`);
      }
    }
    const doneCount = rejecting.length - failures.length;
    setRejecting(null); setSelected([]);
    setNotice(doneCount ? `${doneCount} application(s) marked not progressing; the candidates have been told.` : '');
    setError(failures.join('; '));
    onUpdated?.();
  };

  if (!applications.length) {
    return <div className="ws-panel ws-empty">No applications yet.{['PendingApproval', 'Returned'].includes(vacancy.status) ? ' The advert goes live once the vacancy is approved.' : ''}</div>;
  }

  const counts = PIPELINE_COLUMNS.map((c) => ({ key: c.key, label: c.label, count: searched.filter((a) => column(a) === c.key).length })).filter((c) => c.count > 0);

  return (
    <>
      <Alert type="success" message={notice} />
      <Alert type="error" message={error} />
      <div className="ws-toolbar">
        <input className="ws-field grow" placeholder="Name, email or tag" aria-label="Search applicants" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Chips value={filter} onChange={setFilter} options={[{ key: 'all', label: 'All', count: searched.length }, ...counts]} />
        <span style={{ marginLeft: 'auto' }}>
          <CsvDownloadButton url={`/api/vacancies/${vacancy.id}/export/shortlisting-report`} label="Export" fallbackName="shortlisting-report.csv" />
        </span>
      </div>
      <Panel padded={false}>
        {canAct && selected.length > 0 && (
          <div className="ws-bulk">
            <b>{selected.length} selected</b>
            <Button style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setComposing(true)}><Mail size={14} /> Email</Button>
            <Button variant="ghost" style={{ padding: '4px 12px', fontSize: 13, color: 'var(--color-danger)' }} disabled={!selectedApps.some(rejectable)}
              onClick={() => setRejecting(selectedApps.filter(rejectable))}><XCircle size={14} /> Not progressing</Button>
            <Button variant="ghost" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setSelected([])}>Clear</Button>
          </div>
        )}
        <Table
          rows={rows}
          getRowKey={(a) => a.id}
          onRowClick={onOpen}
          rowClassName={(a) => (column(a) === 'closed' ? 'struck' : '')}
          emptyText="Nobody at this stage."
          columns={[
            ...(canAct ? [{
              key: 'pick', label: '', width: 36,
              render: (a) => (
                <input type="checkbox" aria-label={`Select ${a.candidate.fullName}`} checked={selected.includes(a.id)}
                  onClick={(e) => e.stopPropagation()} onChange={() => toggle(a.id)} />
              )
            }] : []),
            {
              key: 'name', label: 'Candidate', render: (a) => (
                <>
                  <span className="t">{a.candidate.fullName}</span>
                  <div className="s">
                    {a.candidate.candidateType}
                    {a.screeningPassed === false && <> · <span style={{ color: 'var(--color-warning)' }}>flagged at screening</span></>}
                    {a.possibleDuplicates?.length > 0 && <> · <span style={{ color: 'var(--color-danger)' }}>possible duplicate</span></>}
                  </div>
                  {(a.candidate.tags || []).length > 0 && <div style={{ marginTop: 4 }}><TagChips tags={(a.candidate.tags || []).map((t) => t.tag || t)} /></div>}
                </>
              )
            },
            {
              key: 'stage', label: 'Stage', render: (a) => {
                const col = column(a);
                const label = col === 'closed'
                  ? (a.status === 'Withdrawn' ? 'Withdrew' : a.status === 'Offered' ? `Offer ${String(a.offer?.status || '').toLowerCase()}` : 'Not progressing')
                  : PIPELINE_COLUMNS.find((c) => c.key === col)?.label;
                return <Pill tone={STAGE_TONES[col]}>{label}</Pill>;
              }
            },
            {
              key: 'committee', label: 'Committee', render: (a) => (a.committeeBand
                ? <span className="s"><Pill tone={BAND_TONES[a.committeeBand]}>{BAND_LABELS[a.committeeBand] || a.committeeBand}</Pill>{a.committeeScore != null && <> <span className="ws-num">{Number(a.committeeScore).toFixed(1)}</span></>}</span>
                : <span className="s">—</span>)
            },
            { key: 'interview', label: 'Interview', align: 'right', className: 'ws-num', render: (a) => interviewScore(a) ?? <span className="s">—</span> },
            { key: 'merit', label: 'Merit', align: 'right', className: 'ws-num', render: (a) => (a.meritRank ? <>#{a.meritRank} <span className="s">{a.meritListStatus || ''}</span></> : <span className="s">—</span>) },
            { key: 'offer', label: 'Offer', render: (a) => (a.offer?.status ? <Pill tone={OFFER_TONES[a.offer.status]}>{OFFER_LABELS[a.offer.status] || a.offer.status}</Pill> : <span className="s">—</span>) }
          ]}
        />
      </Panel>

      {rejecting && (
        <ReasonDialog title={rejecting.length === 1 ? `Not progressing — ${rejecting[0].candidate.fullName}` : `Not progressing — ${rejecting.length} applications`}
          intro="Each candidate is told their application was not successful. This can't be undone."
          label="Reason (kept on the record)" confirmLabel="Mark not progressing" danger
          onClose={() => setRejecting(null)} onSubmit={rejectAll} />
      )}
      {composing && (
        <BulkEmailComposer applicationIds={selected} count={selected.length} onClose={() => setComposing(false)}
          onSent={(r) => { setComposing(false); setSelected([]); setNotice(`Email sent to ${r.sent}${r.failed ? `; ${r.failed} could not be sent` : ''}.`); }} />
      )}
    </>
  );
}
