import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, CalendarPlus, MapPin, Video, Phone, AlertTriangle, Crown, Search
} from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useDashboardEvents } from '../models/dashboardSocket';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import LiveIndicator from '../components/LiveIndicator';
import StatsStrip from '../components/StatsStrip';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Select from '../components/Select';
import StatusBadge from '../components/StatusBadge';
import LoadingState from '../components/LoadingState';
import InterviewScheduler from '../components/interviews/InterviewScheduler';
import InterviewRoundPanel from '../components/interviews/InterviewRoundPanel';
import { ROUND_LABELS, hintText, inputStyle, chipStyle } from '../components/interviews/formStyles';
import {
  startOfWeek, addDays, sameDay, formatDay, timeRange, venueLabel, formatDateTime, errorMessage
} from '../utils/interviews';
import { debounce } from '../utils/debounce';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
const TABS = [['agenda', 'Agenda'], ['attention', 'Needs attention'], ['scorecards', 'Scorecards']];

const ModeIcon = ({ mode }) => (mode === 'Virtual' ? <Video size={14} /> : mode === 'Phone' ? <Phone size={14} /> : <MapPin size={14} />);

function toDateParam(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Before the interview, what matters is whether the candidate is coming; once
// it has started, whether the panel has scored and the verdict is in.
function RoundBadge({ round }) {
  if (round.status !== 'Scheduled') return <StatusBadge status={round.status} label={ROUND_LABELS[round.status]} />;
  const started = round.scheduledDate && new Date(round.scheduledDate) <= new Date();
  if (!started) return <StatusBadge status={round.candidateResponse} label={ROUND_LABELS[round.candidateResponse]} />;
  return round.progress.complete
    ? <StatusBadge status="Completed" label="Ready to finalize" />
    : <StatusBadge status="Pending" label="Scores due" />;
}

// One interview as a row - shared by the agenda and every attention bucket.
function RoundRow({ round, onOpen, showDate = false }) {
  const app = round.application;
  const { progress } = round;
  return (
    <button
      type="button" onClick={() => onOpen(round.id)} className="list-row"
      style={{
        display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', width: '100%',
        textAlign: 'left', background: 'var(--color-bg)', border: 'none', borderTop: '1px solid var(--color-border)',
        padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'var(--color-text)'
      }}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {showDate && round.scheduledDate && <span style={{ display: 'block', ...hintText }}>{new Date(round.scheduledDate).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
        {round.scheduledDate ? timeRange(round) : 'Time TBC'}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{app.candidate.fullName}</span>
        <span style={{ ...hintText, marginLeft: 6 }}>round {round.roundNumber}</span>
        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', ...hintText, marginTop: 2 }}>
          <span>{app.vacancy.jobRef} · {app.vacancy.title}</span>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><ModeIcon mode={round.mode} /> {venueLabel(round)}</span>
          <span>
            Panel {progress.scored}/{progress.total}
            {round.panelMembers.find((m) => m.isChair) && <> · <Crown size={11} /> {round.panelMembers.find((m) => m.isChair).name}</>}
          </span>
          {round.score != null && <span>Avg {round.score}</span>}
          {round.highSpread && <span style={{ color: 'var(--color-warning)', display: 'inline-flex', gap: 3, alignItems: 'center' }}><AlertTriangle size={12} /> split panel</span>}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <RoundBadge round={round} />
        {round.recommendation && <StatusBadge status={round.recommendation} />}
      </span>
    </button>
  );
}

function RoundList({ rounds, onOpen, showDate, empty }) {
  if (!rounds.length) return <p style={{ ...hintText, padding: '8px 12px', margin: 0 }}>{empty}</p>;
  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      {rounds.map((r) => <RoundRow key={r.id} round={r} onOpen={onOpen} showDate={showDate} />)}
    </div>
  );
}

// The day's interviews, with rounds booked together as one session shown
// under a single session heading.
function DayBlock({ day, rounds, onOpen }) {
  const groups = [];
  for (const r of rounds) {
    const last = groups[groups.length - 1];
    if (r.sessionKey && last && last.sessionKey === r.sessionKey) last.rounds.push(r);
    else groups.push({ sessionKey: r.sessionKey, rounds: [r] });
  }
  const today = sameDay(day, new Date());
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '8px 12px', background: today ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)',
        fontWeight: 600, color: 'var(--color-primary-dark)', display: 'flex', justifyContent: 'space-between'
      }}>
        <span>{formatDay(day)}{today ? ' · Today' : ''}</span>
        <span style={hintText}>{rounds.length} interview{rounds.length === 1 ? '' : 's'}</span>
      </div>
      {groups.map((g, i) => (
        <div key={g.sessionKey || `single-${i}`} style={g.sessionKey && g.rounds.length > 1 ? { borderLeft: '3px solid var(--color-primary)' } : undefined}>
          {g.sessionKey && g.rounds.length > 1 && (
            <div style={{ ...hintText, padding: '6px 12px 0' }}>
              Session · {g.rounds[0].application.vacancy.title} · {g.rounds.length} candidates · {venueLabel(g.rounds[0])}
            </div>
          )}
          {g.rounds.map((r) => <RoundRow key={r.id} round={r} onOpen={onOpen} />)}
        </div>
      ))}
    </Card>
  );
}

function Agenda({ vacancies, onOpen, reloadKey }) {
  const [params, setParams] = useSearchParams();
  const weekStart = useMemo(() => startOfWeek(params.get('week') ? new Date(`${params.get('week')}T00:00:00`) : new Date()), [params]);
  const vacancyId = params.get('vacancyId') || '';
  const [statusFilter, setStatusFilter] = useState('Scheduled');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rounds, setRounds] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setError('');
    staffClient.get('/api/interviews', {
      params: {
        from: weekStart.toISOString(), to: addDays(weekStart, 7).toISOString(),
        vacancyId: vacancyId || undefined, status: statusFilter || undefined, search: query || undefined
      }
    })
      .then((res) => setRounds(res.data))
      .catch((err) => setError(errorMessage(err, 'Could not load the agenda')));
  }, [weekStart, vacancyId, statusFilter, query, reloadKey]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = days.map((d) => ({ day: d, rounds: (rounds || []).filter((r) => r.scheduledDate && sameDay(r.scheduledDate, d)) }));
  const weekLabel = `${weekStart.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Button variant="ghost" aria-label="Previous week" style={{ padding: '6px 8px' }} onClick={() => setParam('week', toDateParam(addDays(weekStart, -7)))}><ChevronLeft size={16} /></Button>
          <span style={{ fontWeight: 600, minWidth: 190, textAlign: 'center' }}>{weekLabel}</span>
          <Button variant="ghost" aria-label="Next week" style={{ padding: '6px 8px' }} onClick={() => setParam('week', toDateParam(addDays(weekStart, 7)))}><ChevronRight size={16} /></Button>
          <Button variant="ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => setParam('week', null)}>This week</Button>
        </div>
        <select aria-label="Vacancy" value={vacancyId} onChange={(e) => setParam('vacancyId', e.target.value)} style={{ ...inputStyle, maxWidth: 280 }}>
          <option value="">All vacancies</option>
          {vacancies.map((v) => <option key={v.id} value={v.id}>{v.jobRef} — {v.title}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['Scheduled', 'Upcoming & open'], ['', 'Everything']].map(([value, label]) => (
            <button key={label} type="button" style={chipStyle(statusFilter === value)} onClick={() => setStatusFilter(value)}>{label}</button>
          ))}
        </div>
        <label style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--color-text-muted)' }} />
          <input aria-label="Search candidates" placeholder="Candidate name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: '100%', paddingLeft: 28 }} />
        </label>
      </div>
      <Alert type="error" message={error} />
      {!rounds && !error && <LoadingState label="Loading the agenda..." />}
      {rounds && rounds.length === 0 && (
        <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No interviews {statusFilter ? 'booked' : ''} this week{vacancyId ? ' for this vacancy' : ''}.</p></Card>
      )}
      {rounds && byDay.filter((d) => d.rounds.length).map((d) => <DayBlock key={d.day.toISOString()} day={d.day} rounds={d.rounds} onOpen={onOpen} />)}
    </div>
  );
}

const BUCKETS = [
  { key: 'rescheduleRequests', title: 'Candidates asking for another time', hint: 'Open one to reschedule it - the candidate\'s note says what suits them.', empty: 'No requests.' },
  { key: 'readyToFinalize', title: 'Ready to finalize', hint: 'Every panel score is in. Finalize the recommendation so offers can move.', empty: 'Nothing waiting.' },
  { key: 'awaitingScores', title: 'Scores outstanding', hint: 'The interview has happened but not every panelist has scored. Send links or record scores.', empty: 'All caught up.' },
  { key: 'unconfirmed', title: 'Not yet confirmed by the candidate (next 72 hours)', hint: 'Consider a call to make sure they are coming.', empty: 'Everyone upcoming has replied.' },
  { key: 'noPanel', title: 'No panel yet', hint: 'Add panelists so they get the invite in time.', empty: 'Every interview has a panel.' },
  { key: 'noDate', title: 'Date to be confirmed', hint: 'Booked without a time - reschedule to set one.', empty: 'None.' }
];

function Attention({ data, onOpen, onSchedule, canEdit }) {
  if (!data) return <LoadingState label="Checking what needs attention..." />;
  const busy = BUCKETS.filter((b) => data[b.key].length > 0);
  return (
    <div>
      {data.awaitingScheduling.length > 0 && (
        <Card accent="var(--color-primary)">
          <strong>Shortlisted, not yet scheduled</strong>
          <p style={{ ...hintText, margin: '4px 0 8px' }}>Approved shortlists with candidates who have no interview booked.</p>
          {data.awaitingScheduling.map((v) => (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--color-border)' }}>
              <span>{v.jobRef} · {v.title} <span style={hintText}>— {v.count} candidate{v.count === 1 ? '' : 's'}</span></span>
              {canEdit && <Button variant="secondary" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => onSchedule(v.id)}>Schedule</Button>}
            </div>
          ))}
        </Card>
      )}
      {busy.length === 0 && data.awaitingScheduling.length === 0 && (
        <Card><p style={{ margin: 0 }}>Nothing needs attention right now.</p></Card>
      )}
      {busy.map((b) => (
        <Card key={b.key} style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px' }}>
            <strong>{b.title}</strong> <span style={hintText}>({data[b.key].length})</span>
            <div style={hintText}>{b.hint}</div>
          </div>
          <RoundList rounds={data[b.key]} onOpen={onOpen} showDate empty={b.empty} />
        </Card>
      ))}
    </div>
  );
}

function Scorecards({ vacancies, onOpen, reloadKey }) {
  const [params, setParams] = useSearchParams();
  const vacancyId = params.get('vacancyId') || '';
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vacancyId) { setRows(null); return; }
    setError('');
    staffClient.get(`/api/interviews/vacancies/${vacancyId}/scorecard`)
      .then((res) => setRows(res.data))
      .catch((err) => setError(errorMessage(err, 'Could not load the scorecard')));
  }, [vacancyId, reloadKey]);

  const criteriaNames = useMemo(() => {
    const names = [];
    for (const r of rows || []) for (const c of r.latestRound.criterionAverages || []) if (!names.includes(c.name)) names.push(c.name);
    return names;
  }, [rows]);

  return (
    <div>
      <Select label="Vacancy" value={vacancyId} onChange={(e) => {
        const next = new URLSearchParams(params);
        if (e.target.value) next.set('vacancyId', e.target.value); else next.delete('vacancyId');
        setParams(next, { replace: true });
      }}>
        <option value="">Choose a vacancy to compare its candidates...</option>
        {vacancies.map((v) => <option key={v.id} value={v.id}>{v.jobRef} — {v.title}</option>)}
      </Select>
      <Alert type="error" message={error} />
      {vacancyId && !rows && !error && <LoadingState />}
      {rows && rows.length === 0 && <Card><p style={{ margin: 0 }}>Nobody has been interviewed for this vacancy yet.</p></Card>}
      {rows && rows.length > 0 && (
        <Card style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['#', 'Candidate', 'Latest round', 'Score', ...criteriaNames, 'Panel', 'Verdict', 'Offer'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const lr = r.latestRound;
                return (
                  <tr key={r.applicationId} className="list-row" onClick={() => onOpen(lr.id)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 12px' }}>{lr.score != null ? i + 1 : '—'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <strong>{r.candidateName}</strong>
                      <div style={hintText}>{r.candidateType}{r.listStatus ? ` · ${r.listStatus}` : ''}{r.noShows ? ` · ${r.noShows} no-show` : ''}</div>
                    </td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      Round {lr.roundNumber} <StatusBadge status={lr.status} label={ROUND_LABELS[lr.status]} />
                      <div style={hintText}>{lr.scheduledDate ? formatDateTime(lr.scheduledDate) : 'TBC'}</div>
                    </td>
                    <td style={{ padding: '8px 12px', minWidth: 110 }}>
                      {lr.score != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 8, background: 'var(--color-bg-subtle)', borderRadius: 999 }}>
                            <div style={{ width: `${lr.score}%`, height: '100%', borderRadius: 999, background: 'var(--color-primary)' }} />
                          </div>
                          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{lr.score}</strong>
                        </div>
                      ) : '—'}
                      {lr.highSpread && <div style={{ fontSize: 11, color: 'var(--color-warning)' }}>panel split ({lr.progress.spread})</div>}
                    </td>
                    {criteriaNames.map((name) => {
                      const c = (lr.criterionAverages || []).find((x) => x.name === name);
                      return <td key={name} style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>{c?.average ?? '—'}</td>;
                    })}
                    <td style={{ padding: '8px 12px' }}>{lr.progress.scored}/{lr.progress.total}</td>
                    <td style={{ padding: '8px 12px' }}>{lr.recommendation ? <StatusBadge status={lr.recommendation} /> : '—'}</td>
                    <td style={{ padding: '8px 12px' }}>{r.offerStatus ? <StatusBadge status={r.offerStatus} /> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {criteriaNames.length > 0 && <p style={{ ...hintText, padding: '8px 12px', margin: 0 }}>Rubric columns are panel averages on the 1-5 scale.</p>}
        </Card>
      )}
    </div>
  );
}

// HR's single place for interviews across every vacancy: a weekly agenda,
// what needs doing next, and a side-by-side scorecard per vacancy. Scheduling
// (one candidate or a whole session) and everything about one round open
// in modals on top, so HR never loses their place.
export default function InterviewHub() {
  const { staff } = useAuth();
  const canEdit = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'agenda';
  const openRoundId = Number(params.get('round')) || null;

  const [attention, setAttention] = useState(null);
  const [vacancies, setVacancies] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [scheduler, setScheduler] = useState(null); // { vacancyId? }

  const loadAttention = useCallback(() => {
    staffClient.get('/api/interviews/attention').then((res) => setAttention(res.data)).catch(() => {});
  }, []);
  useEffect(() => { loadAttention(); }, [loadAttention, reloadKey]);
  useEffect(() => {
    staffClient.get('/api/vacancies/admin')
      .then((res) => setVacancies(res.data.filter((v) => !['PendingApproval', 'Draft'].includes(v.status))))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedRefresh = useCallback(debounce(refresh, 500), [refresh]);
  const { connected } = useDashboardEvents((event) => {
    if (['InterviewUpdated', 'InterviewRecommendation', 'ApplicationUpdated', 'ShortlistApproved'].includes(event)) debouncedRefresh();
  });

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: key !== 'tab' });
  };

  const needs = attention
    ? BUCKETS.reduce((n, b) => n + attention[b.key].length, 0)
    : 0;
  const stats = attention ? [
    { label: 'today', value: attention.counts.today, color: 'var(--color-primary)' },
    { label: 'in the next 7 days', value: attention.counts.next7Days },
    { label: 'confirmed by candidates', value: attention.counts.confirmed, color: 'var(--color-accent)' },
    { label: 'awaiting scores', value: attention.awaitingScores.length, color: attention.awaitingScores.length ? 'var(--color-warning)' : undefined },
    { label: 'ready to finalize', value: attention.readyToFinalize.length, color: attention.readyToFinalize.length ? 'var(--color-accent)' : undefined },
    { label: 'reschedule requests', value: attention.rescheduleRequests.length, color: attention.rescheduleRequests.length ? 'var(--color-danger)' : undefined }
  ] : [];

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="interviews" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <PageHeader title="Interview Hub" subtitle="Schedule, run and decide interviews across every vacancy" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <LiveIndicator connected={connected} />
            {canEdit && <Button onClick={() => setScheduler({})}><CalendarPlus size={16} /> Schedule interviews</Button>}
          </div>
        </div>

        {stats.length > 0 && <StatsStrip stats={stats} />}

        <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setParam('tab', key === 'agenda' ? null : key)} style={{
              background: 'none', border: 'none', padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15,
              borderBottom: `2px solid ${tab === key ? 'var(--color-primary)' : 'transparent'}`,
              color: tab === key ? 'var(--color-primary-dark)' : 'var(--color-text-muted)', fontWeight: 600
            }}>
              {label}
              {key === 'attention' && needs > 0 && (
                <span style={{ marginLeft: 6, background: 'var(--color-danger)', color: '#fff', borderRadius: 999, padding: '0 7px', fontSize: 12 }}>{needs}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'agenda' && <Agenda vacancies={vacancies} onOpen={(id) => setParam('round', id)} reloadKey={reloadKey} />}
        {tab === 'attention' && <Attention data={attention} onOpen={(id) => setParam('round', id)} onSchedule={(vacancyId) => setScheduler({ vacancyId })} canEdit={canEdit} />}
        {tab === 'scorecards' && <Scorecards vacancies={vacancies} onOpen={(id) => setParam('round', id)} reloadKey={reloadKey} />}
      </div>

      {scheduler && (
        <InterviewScheduler
          presetVacancyId={scheduler.vacancyId}
          onClose={() => setScheduler(null)}
          onScheduled={refresh}
        />
      )}
      {openRoundId && (
        <InterviewRoundPanel roundId={openRoundId} onClose={() => setParam('round', null)} onChanged={refresh} />
      )}
    </div>
  );
}
