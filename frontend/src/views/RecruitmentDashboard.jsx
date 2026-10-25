import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronDown, ChevronUp, Info, Printer, Timer, Megaphone, Filter, Users, Percent, Briefcase, FileCheck2,
  Hourglass, Stamp, Gauge, UsersRound, Handshake
} from 'lucide-react';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import AnalyticsTrends from './Analytics';
import { PageTop, Panel } from '../components/workspace/ui';
import DonutChart from '../components/charts/DonutChart';
import BarList from '../components/charts/BarList';
import { CHART_SERIES, STATUS_FILL } from '../theme/chartPalette';
import Card from '../components/Card';
import Alert from '../components/Alert';
import Button from '../components/Button';
import Select from '../components/Select';
import TextField from '../components/TextField';
import LoadingState from '../components/LoadingState';
import CsvDownloadButton from '../components/CsvDownloadButton';
import Pagination, { usePagination } from '../components/Pagination';
import { POSITION_LEVELS } from '../utils/positionLevels';
import { printDocument, escapeHtml } from '../utils/printDocument';

// The recruitment dashboard (FR-ATS-070 to 074; backend
// recruitmentMetricsService): every metric with its formula, data source and
// refresh, the rows behind it, filters (kept in the URL so a filtered view
// can be shared with anyone allowed to see it), a CSV export and a printable
// version for PDF. Manager+.

const FILTER_KEYS = ['from', 'to', 'directorateId', 'departmentId', 'positionId', 'grade', 'location', 'postingType'];

// Each metric's icon and colour. Rates where higher is plainly better are
// green, gold or red against `good`/`fair` (a first setting - HR can say
// where the lines should be); the rest wear a colour for their kind
// (blue time, violet people) with no good or bad implied.
const LOOKS = {
  timeToHire: { icon: Timer, tone: 'info' },
  sourceOfHire: { icon: Megaphone, tone: 'violet' },
  pipelineHealth: { icon: Filter, tone: 'info' },
  applicantsPerPosition: { icon: Users, tone: 'violet' },
  selectionRatio: { icon: Percent, tone: 'violet' },
  openPositions: { icon: Briefcase, tone: 'brand' },
  completionRate: { icon: FileCheck2, good: 70, fair: 40 },
  requisitionAging: { icon: Hourglass, tone: 'warn' },
  approvalTurnaround: { icon: Stamp, tone: 'info' },
  bottlenecks: { icon: Gauge, tone: 'warn' },
  committeeParticipation: { icon: UsersRound, good: 80, fair: 50 },
  offerOutcomes: { icon: Handshake, good: 70, fair: 50 }
};
const TONE_VARS = {
  ok: 'var(--color-accent)', warn: 'var(--color-gold)', bad: 'var(--color-danger)', info: 'var(--color-sky)',
  brand: 'var(--color-primary-dark)', violet: 'var(--color-violet)', neutral: 'var(--color-text-muted)'
};
const RATING = { ok: 'Good', warn: 'Fair', bad: 'Low' };
function lookOf(m) {
  const look = LOOKS[m.key] || {};
  let tone = look.tone || 'brand';
  if (look.good != null) tone = m.value == null ? 'neutral' : m.value >= look.good ? 'ok' : m.value >= look.fair ? 'warn' : 'bad';
  return { Icon: look.icon || Info, color: TONE_VARS[tone], rating: look.good != null ? RATING[tone] : null };
}

// Offer outcomes in the order validated for neighbouring colours (red and
// green never touch; theme/chartPalette.js).
const OUTCOME_COLORS = [['Accepted', STATUS_FILL.good], ['Waiting', STATUS_FILL.info], ['Expired', STATUS_FILL.waiting], ['Declined', STATUS_FILL.bad], ['Withdrawn', STATUS_FILL.neutral]];

// The charts at the top, each drawn from a metric's own rows; clicking one
// opens that metric's figures and records below.
function DashboardCharts({ metrics, onOpen }) {
  const m = Object.fromEntries(metrics.map((x) => [x.key, x]));
  const pipeline = (m.pipelineHealth?.rows || []).map((r) => ({
    key: r.stage, label: r.stage, value: r.reached,
    note: r.fromPrevious != null ? `${r.fromPrevious}% of the stage before` : undefined,
    color: r.stage === 'Hired' ? STATUS_FILL.good : STATUS_FILL.info
  }));
  const outcomes = OUTCOME_COLORS.map(([key, color]) => ({ key, label: key, color, value: m.offerOutcomes?.rows.find((r) => r.outcome === key)?.offers || 0 }));
  // Sources by applicants, in a fixed order of hue; past seven they share "Other".
  const sources = [...(m.sourceOfHire?.rows || [])].sort((a, b) => b.applicants - a.applicants);
  const shown = sources.slice(0, 7).map((r, i) => ({ key: r.source, label: r.source, value: r.applicants, color: CHART_SERIES[i] }));
  const rest = sources.slice(7).reduce((n, r) => n + r.applicants, 0);
  if (rest) shown.push({ key: 'Other', label: 'Other', value: rest, color: STATUS_FILL.neutral });
  const steps = (m.bottlenecks?.rows || []).filter((r) => r.averageDays != null && r.stage !== 'Approved to applications closing');
  const slowest = Math.max(0, ...steps.map((r) => r.averageDays));
  const stepRows = steps.map((r) => ({
    key: r.stage, label: r.stage, value: r.averageDays, note: `${r.vacancies} ${r.vacancies === 1 ? 'vacancy' : 'vacancies'}`,
    color: r.averageDays === slowest ? STATUS_FILL.bad : STATUS_FILL.info
  }));
  return (
    <div className="ws-charts two">
      <Panel title="Pipeline" note="Applications reaching each stage - click for the figures">
        <BarList rows={pipeline} onSelect={() => onOpen('pipelineHealth')} emptyText="No applications in this range." />
      </Panel>
      <Panel title="Offer outcomes" note="Issued offers and how they ended">
        <DonutChart data={outcomes} centerLabel="offers" onSelect={() => onOpen('offerOutcomes')} emptyText="No offers issued in this range." />
      </Panel>
      <Panel title="Where applicants saw the advert" note="Applicants by source">
        <DonutChart data={shown} centerLabel="applicants" onSelect={() => onOpen('sourceOfHire')} emptyText="No applications in this range." />
      </Panel>
      <Panel title="How long each step takes" note="Average days per vacancy; the slowest in red">
        <BarList rows={stepRows} formatValue={(v) => `${v} d`} onSelect={() => onOpen('bottlenecks')} emptyText="Not enough history yet." />
      </Panel>
    </div>
  );
}

function display(m) {
  if (m.value == null) return '-';
  return m.unit && !['', '%'].includes(m.unit) ? `${m.value} ${m.unit}` : `${m.value}${m.unit || ''}`;
}

function MetricTable({ metric }) {
  const pager = usePagination(metric.rows);
  if (!metric.rows.length) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No records behind this yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>{metric.columns.map((c) => <th key={c.key} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {pager.pageRows.map((r, i) => (
            <tr key={pager.offset + i}>{metric.columns.map((c) => <td key={c.key} style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>{r[c.key] ?? '-'}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <Pagination {...pager.props} />
    </div>
  );
}

function MetricCard({ metric, open, onToggle }) {
  const { Icon, color, rating } = lookOf(metric);
  return (
    <Card style={{ marginBottom: 0, gridColumn: open ? '1 / -1' : undefined, borderTop: `4px solid ${color}`,
      background: `linear-gradient(180deg, color-mix(in srgb, ${color} 7%, #fff), #fff 60%)` }}>
      <button type="button" id={`metric-${metric.key}`} onClick={onToggle} aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', scrollMarginTop: 'calc(var(--navbar-height) + 16px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', flex: 'none', color, background: `color-mix(in srgb, ${color} 15%, #fff)` }}><Icon size={15} /></span>
            {metric.label}
          </span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', margin: '6px 0 4px' }}>
          <span style={{ fontSize: 24, fontWeight: 700 }}>{display(metric)}</span>
          {rating && <span className="status-badge" style={{ '--badge-color': color }}>{rating}</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{metric.summary}</div>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, background: 'var(--color-bg-subtle)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', marginBottom: 10 }}>
            <div><Info size={12} /> <strong>How it is worked out:</strong> {metric.formula}</div>
            <div><strong>Data:</strong> {metric.source}</div>
            <div><strong>Refreshed:</strong> {metric.refresh}</div>
          </div>
          <MetricTable metric={metric} />
        </div>
      )}
    </Card>
  );
}

export default function RecruitmentDashboard() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])), [params]);
  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [directorates, setDirectorates] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);

  useEffect(() => {
    staffClient.get('/api/directorates').then((r) => setDirectorates(r.data)).catch(() => {});
    staffClient.get('/api/departments/approved').then((r) => setDepartments(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!filters.departmentId) { setPositions([]); return; }
    staffClient.get(`/api/departments/${filters.departmentId}/positions`).then((r) => setPositions(r.data)).catch(() => setPositions([]));
  }, [filters.departmentId]);
  useEffect(() => {
    setReport(null); setError('');
    staffClient.get(`/api/analytics/recruitment${query ? `?${query}` : ''}`)
      .then((r) => setReport(r.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load the dashboard'));
  }, [query]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'directorateId') { next.delete('departmentId'); next.delete('positionId'); }
    if (key === 'departmentId') next.delete('positionId');
    setParams(next, { replace: true });
  };
  const shownDepartments = filters.directorateId ? departments.filter((d) => String(d.directorateId ?? d.directorate?.id) === filters.directorateId) : departments;

  const print = () => {
    const described = FILTER_KEYS.filter((k) => filters[k]).map((k) => `${k}: ${filters[k]}`).join(', ') || 'none';
    const body = `<h1>UCAA recruitment dashboard</h1><p>Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}. Filters: ${escapeHtml(described)}. ${report.vacancies} vacancy(ies) in range.</p>`
      + '<table><thead><tr><th>Metric</th><th>Value</th><th>In brief</th><th>How it is worked out</th></tr></thead><tbody>'
      + report.metrics.map((m) => `<tr><td>${escapeHtml(m.label)}</td><td>${escapeHtml(display(m))}</td><td>${escapeHtml(m.summary)}</td><td>${escapeHtml(m.formula)}</td></tr>`).join('')
      + '</tbody></table>'
      + report.metrics.filter((m) => m.rows.length).map((m) => `<h2>${escapeHtml(m.label)}</h2><table><thead><tr>${m.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>`
        + m.rows.map((r) => `<tr>${m.columns.map((c) => `<td>${escapeHtml(r[c.key] ?? '-')}</td>`).join('')}</tr>`).join('') + '</tbody></table>').join('');
    printDocument('Recruitment dashboard', body);
  };

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="dashboard" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop title="Recruitment dashboard" subtitle="Time to hire, source of hire, pipeline health and more. Click a figure for how it is worked out and the records behind it."
          actions={<>
            <CsvDownloadButton url={`/api/analytics/recruitment/export${query ? `?${query}` : ''}`} label="Export" fallbackName="recruitment-dashboard.csv" />
            <Button variant="ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={print} disabled={!report}><Printer size={14} /> Print or save as PDF</Button>
          </>} />
        <Alert type="error" message={error} />

        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0 12px' }}>
            <TextField label="Raised from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
            <TextField label="Raised to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
            <Select label="Directorate" value={filters.directorateId} onChange={(e) => setFilter('directorateId', e.target.value)}>
              <option value="">All</option>
              {directorates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select label="Department" value={filters.departmentId} onChange={(e) => setFilter('departmentId', e.target.value)}>
              <option value="">All</option>
              {shownDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select label="Title" value={filters.positionId} onChange={(e) => setFilter('positionId', e.target.value)} disabled={!filters.departmentId}>
              <option value="">{filters.departmentId ? 'All' : 'Choose a department'}</option>
              {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select label="Grade" value={filters.grade} onChange={(e) => setFilter('grade', e.target.value)}>
              <option value="">All</option>
              {POSITION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
            <TextField label="Location" value={filters.location} placeholder="e.g. Entebbe" onChange={(e) => setFilter('location', e.target.value)} />
            <Select label="Advert type" value={filters.postingType} onChange={(e) => setFilter('postingType', e.target.value)}>
              <option value="">Both</option>
              <option value="Internal">Internal</option>
              <option value="External">External</option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>
            {report && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{report.vacancies} vacancy(ies) raised in this range</span>}
          </div>
        </Card>

        {!report && !error && <LoadingState label="Working out the figures..." />}
        {report && <DashboardCharts metrics={report.metrics} onOpen={(key) => {
          setOpen(key);
          setTimeout(() => document.getElementById(`metric-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
        }} />}
        {report && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 'var(--spacing-md)' }}>
            {report.metrics.map((m) => (
              <MetricCard key={m.key} metric={m} open={open === m.key} onToggle={() => setOpen(open === m.key ? null : m.key)} />
            ))}
          </div>
        )}
        <AnalyticsTrends />
      </div>
    </div>
  );
}
