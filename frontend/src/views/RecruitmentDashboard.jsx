import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Info, Printer } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Alert from '../components/Alert';
import Button from '../components/Button';
import Select from '../components/Select';
import TextField from '../components/TextField';
import LoadingState from '../components/LoadingState';
import CsvDownloadButton from '../components/CsvDownloadButton';
import { POSITION_LEVELS } from '../utils/positionLevels';
import { printDocument, escapeHtml } from '../utils/printDocument';

// The recruitment dashboard (FR-ATS-070 to 074; backend
// recruitmentMetricsService): every metric with its formula, data source and
// refresh, the rows behind it, filters (kept in the URL so a filtered view
// can be shared with anyone allowed to see it), a CSV export and a printable
// version for PDF. Manager+.

const FILTER_KEYS = ['from', 'to', 'directorateId', 'departmentId', 'positionId', 'grade', 'location', 'postingType'];

function display(m) {
  if (m.value == null) return '-';
  return m.unit && !['', '%'].includes(m.unit) ? `${m.value} ${m.unit}` : `${m.value}${m.unit || ''}`;
}

function MetricTable({ metric }) {
  if (!metric.rows.length) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No records behind this yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>{metric.columns.map((c) => <th key={c.key} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {metric.rows.map((r, i) => (
            <tr key={i}>{metric.columns.map((c) => <td key={c.key} style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>{r[c.key] ?? '-'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({ metric, open, onToggle }) {
  return (
    <Card style={{ marginBottom: 0, gridColumn: open ? '1 / -1' : undefined }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{metric.label}</span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, margin: '4px 0' }}>{display(metric)}</div>
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
      <HRSidebar active="analytics" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <PageHeader title="Recruitment dashboard" subtitle="Time to hire, source of hire, pipeline health and more - click a figure for how it is worked out and the records behind it" />
        <p style={{ marginTop: -12 }}><Link to="/hr/analytics">&larr; Analytics</Link></p>
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
            <Select label="Position" value={filters.positionId} onChange={(e) => setFilter('positionId', e.target.value)} disabled={!filters.departmentId}>
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
            <CsvDownloadButton url={`/api/analytics/recruitment/export${query ? `?${query}` : ''}`} label="Export (Excel / CSV)" fallbackName="recruitment-dashboard.csv" />
            <Button variant="ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={print} disabled={!report}><Printer size={14} /> Print or save as PDF</Button>
            {report && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{report.vacancies} vacancy(ies) raised in this range</span>}
          </div>
        </Card>

        {!report && !error && <LoadingState label="Working out the figures..." />}
        {report && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 'var(--spacing-md)' }}>
            {report.metrics.map((m) => (
              <MetricCard key={m.key} metric={m} open={open === m.key} onToggle={() => setOpen(open === m.key ? null : m.key)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
