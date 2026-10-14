import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import CsvDownloadButton from '../components/CsvDownloadButton';
import { PageTop, Panel, Table, Chips, SidePanel, KeyValues, Pill } from '../components/workspace/ui';
import { browserName } from '../utils/userAgent';

// The audit log (/hr/audit-log, system administrators only): who did what,
// when and from where - backend services/adminAuditService.js.
//   Activity     - every change anyone asked for, sign-ins included, with
//                  the outcome, IP address and browser
//   Changes      - the audit trail: what changed, from what to what
//   Data viewed  - who looked at candidate data
// Filters are kept in the page address, so a search can be shared. A row
// opens in a side panel with everything recorded about it, and "Everything
// from this request" shows the activity and changes one action made.

const TABS = [
  { key: 'activity', label: 'Activity' },
  { key: 'changes', label: 'Changes' },
  { key: 'access', label: 'Data viewed' }
];

const ACTOR_TYPES = [
  ['', 'Anyone'], ['staff', 'Staff'], ['candidate', 'Candidates'], ['committee', 'Committee members'],
  ['anonymous', 'Not signed in'], ['system', 'The system (scheduled jobs)']
];

const FILTER_KEYS = ['from', 'to', 'staffUserId', 'actorType', 'outcome', 'signIns', 'entityType', 'ip', 'q', 'requestId'];

const OUTCOME_TONES = { success: 'ok', refused: 'warn', failed: 'bad' };
const OUTCOME_LABELS = { success: 'Done', refused: 'Refused', failed: 'Failed' };

function when(value) {
  return value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

function who(row) {
  const name = row.staff?.name || row.performedBy?.name || row.actorLabel;
  if (name) return name;
  return { anonymous: 'Not signed in', system: 'The system', candidate: 'A candidate', committee: 'A committee member' }[row.actorType] || '';
}

const ACCOUNT_LABELS = Object.fromEntries(ACTOR_TYPES.filter(([k]) => k));

function Who({ row }) {
  return (
    <>
      <span className="t">{who(row)}</span>
      <div className="s">{ACCOUNT_LABELS[row.actorType] || row.actorType || ''}{row.actingAs ? ` · acting for ${row.actingAs.name}` : ''}</div>
    </>
  );
}

function Where({ ip, ua }) {
  return (
    <>
      <span className="ws-mono">{ip || '—'}</span>
      {ua && <div className="s">{browserName(ua)}</div>}
    </>
  );
}

function value(v) {
  if (v === null || v === undefined || v === '') return <span className="ws-note">empty</span>;
  if (typeof v === 'object') return <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{JSON.stringify(v)}</code>;
  return String(v);
}

function ChangesTable({ changes }) {
  const entries = Object.entries(changes || {});
  if (!entries.length) return null;
  return (
    <table className="ws-table" style={{ marginTop: 8 }}>
      <thead><tr><th>Field</th><th>From</th><th>To</th></tr></thead>
      <tbody>
        {entries.map(([field, c]) => (
          <tr key={field}><td className="ws-mono">{field}</td><td>{value(c.from)}</td><td>{value(c.to)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function columnsFor(tab) {
  if (tab === 'activity') {
    return [
      { key: 'at', label: 'When', width: 170, render: (r) => <span className="s">{when(r.at)}</span> },
      { key: 'who', label: 'Who', render: (r) => <Who row={r} /> },
      { key: 'what', label: 'What', render: (r) => <><span className="t">{r.action}</span>{r.detail?.email && <div className="s">{r.detail.email}</div>}</> },
      { key: 'outcome', label: 'Outcome', width: 100, render: (r) => <Pill tone={OUTCOME_TONES[r.outcome]}>{OUTCOME_LABELS[r.outcome] || r.outcome}</Pill> },
      { key: 'where', label: 'From', width: 170, render: (r) => <Where ip={r.ipAddress} ua={r.userAgent} /> }
    ];
  }
  if (tab === 'changes') {
    return [
      { key: 'at', label: 'When', width: 170, render: (r) => <span className="s">{when(r.timestamp)}</span> },
      { key: 'who', label: 'Who', render: (r) => <Who row={r} /> },
      { key: 'what', label: 'What', render: (r) => <><span className="t">{r.action}</span><div className="s">{r.entityType} #{r.entityId}{r.changes ? ` · ${Object.keys(r.changes).length} field(s) changed` : ''}</div></> },
      { key: 'where', label: 'From', width: 170, render: (r) => <Where ip={r.ipAddress} ua={r.userAgent} /> }
    ];
  }
  return [
    { key: 'at', label: 'When', width: 170, render: (r) => <span className="s">{when(r.at)}</span> },
    { key: 'who', label: 'Who', render: (r) => <Who row={r} /> },
    { key: 'what', label: 'What', render: (r) => <><span className="t">{r.action}</span><div className="s">{[r.vacancyId && `vacancy #${r.vacancyId}`, r.applicationId && `application #${r.applicationId}`, Array.isArray(r.candidateIds) && r.candidateIds.length && `${r.candidateIds.length} candidate(s)`].filter(Boolean).join(' · ')}</div></> },
    { key: 'where', label: 'From', width: 170, render: (r) => <Where ip={r.ip} ua={r.userAgent} /> }
  ];
}

function Details({ tab, row, onRequest }) {
  const common = [
    ['Who', who(row)],
    ['Account type', ACCOUNT_LABELS[row.actorType] || row.actorType],
    row.staff?.email || row.performedBy?.email ? ['Email', row.staff?.email || row.performedBy?.email] : null,
    row.actingAs ? ['Acting for (delegation)', row.actingAs.name] : null
  ].filter(Boolean);
  if (tab === 'activity') {
    return (
      <>
        <KeyValues rows={[
          ['When', when(row.at)], ...common,
          ['What', row.action],
          ['Outcome', `${OUTCOME_LABELS[row.outcome] || row.outcome} (${row.statusCode})`],
          ['Request', <span className="ws-mono">{row.method} {row.path}</span>],
          ['Took', row.durationMs != null ? `${row.durationMs} ms` : null],
          ['IP address', <span className="ws-mono">{row.ipAddress || '—'}</span>],
          ['Browser', row.userAgent],
          ['Details', row.detail ? value(row.detail) : null],
          ['Request id', <span className="ws-mono">{row.requestId}</span>]
        ]} />
        {row.requestId && <p><Button variant="secondary" onClick={() => onRequest(row.requestId, 'changes')}>What this request changed</Button></p>}
      </>
    );
  }
  if (tab === 'changes') {
    return (
      <>
        <KeyValues rows={[
          ['When', when(row.timestamp)], ...common,
          ['What', row.action],
          ['Record', `${row.entityType} #${row.entityId}`],
          ['Comment', row.comment],
          ['Request', row.requestMethod ? <span className="ws-mono">{row.requestMethod} {row.requestPath}</span> : null],
          ['IP address', <span className="ws-mono">{row.ipAddress || '—'}</span>],
          ['Browser', row.userAgent],
          ['Request id', row.requestId ? <span className="ws-mono">{row.requestId}</span> : null]
        ]} />
        {row.changes && <><h3 style={{ fontSize: 14, margin: '16px 0 0' }}>What changed</h3><ChangesTable changes={row.changes} /></>}
        {row.details && <><h3 style={{ fontSize: 14, margin: '16px 0 4px' }}>Also recorded</h3>{value(row.details)}</>}
        {row.requestId && <p><Button variant="secondary" onClick={() => onRequest(row.requestId, 'activity')}>The request behind it</Button></p>}
      </>
    );
  }
  return (
    <KeyValues rows={[
      ['When', when(row.at)], ...common,
      ['What', row.action],
      ['Vacancy', row.vacancyId ? `#${row.vacancyId}` : null],
      ['Application', row.applicationId ? `#${row.applicationId}` : null],
      ['Candidates', Array.isArray(row.candidateIds) && row.candidateIds.length ? row.candidateIds.map((id) => `#${id}`).join(', ') : null],
      ['Details', row.detail ? value(row.detail) : null],
      ['IP address', <span className="ws-mono">{row.ip || '—'}</span>],
      ['Browser', row.userAgent],
      ['Request id', row.requestId ? <span className="ws-mono">{row.requestId}</span> : null]
    ]} />
  );
}

export default function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'activity';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])), [params]);
  const [draft, setDraft] = useState(filters);
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState({ staff: [], entityTypes: [] });
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => { setDraft(filters); }, [filters]);
  useEffect(() => {
    staffClient.get('/api/admin/audit/meta').then((res) => setMeta(res.data)).catch(() => {});
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return q;
  }, [filters]);

  const load = useCallback(() => {
    setData(null); setError('');
    const q = new URLSearchParams(query);
    q.set('page', page);
    staffClient.get(`/api/admin/audit/${tab}?${q}`)
      .then((res) => setData(res.data))
      .catch((err) => { setData({ rows: [], total: 0, page: 1, pageSize: 50 }); setError(err.response?.data?.error || 'Could not load the audit log'); });
  }, [tab, page, query]);
  useEffect(() => { load(); }, [load]);

  const go = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
    setOpen(null);
  };
  const apply = (e) => { e?.preventDefault(); go(draft); };
  const clear = () => go(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])));
  const showRequest = (requestId, toTab) => go({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])), requestId, tab: toTab });

  const rows = data?.rows || [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = FILTER_KEYS.some((k) => filters[k]);
  const field = (key, props = {}) => ({ value: draft[key], onChange: (e) => setDraft({ ...draft, [key]: e.target.type === 'checkbox' ? (e.target.checked ? 'true' : '') : e.target.value }), ...props });

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="audit-log" />
      <div className="ws-page" style={{ flex: 1, minWidth: 0 }}>
        <PageTop
          title="Audit log"
          subtitle="Who did what, when and from where - every change and sign-in, what each change was, and who viewed candidate data"
          actions={<CsvDownloadButton url={`/api/admin/audit/${tab}/export?${query}`} label="Export CSV" fallbackName={`audit-${tab}.csv`} />}
        />
        <Alert type="error" message={error} />

        <Chips value={tab} onChange={(key) => go({ tab: key, outcome: '', signIns: '', entityType: '' })}
          options={TABS.map((t) => ({ key: t.key, label: t.label, count: t.key === tab && data ? data.total : undefined }))} />

        <form className="ws-toolbar" onSubmit={apply} style={{ flexWrap: 'wrap', marginTop: 'var(--spacing-md)' }}>
          <label className="ws-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>From
            <input className="ws-field" type="date" aria-label="From" {...field('from')} />
          </label>
          <label className="ws-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>To
            <input className="ws-field" type="date" aria-label="To" {...field('to')} />
          </label>
          <select className="ws-field" aria-label="Staff member" {...field('staffUserId')}>
            <option value="">Any staff member</option>
            {meta.staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (deactivated)'}</option>)}
          </select>
          <select className="ws-field" aria-label="Account type" {...field('actorType')}>
            {ACTOR_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {tab === 'activity' && (
            <select className="ws-field" aria-label="Outcome" {...field('outcome')}>
              <option value="">Any outcome</option>
              <option value="success">Done</option>
              <option value="refused">Refused</option>
              <option value="failed">Failed</option>
            </select>
          )}
          {tab === 'changes' && (
            <select className="ws-field" aria-label="Record type" {...field('entityType')}>
              <option value="">Any record</option>
              {meta.entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <input className="ws-field" placeholder="IP address" aria-label="IP address" style={{ width: 140 }} {...field('ip')} />
          <input className="ws-field grow" placeholder="Search who, what or where" aria-label="Search" {...field('q')} />
          {tab === 'activity' && (
            <label className="ws-note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={draft.signIns === 'true'} onChange={field('signIns').onChange} /> Sign-ins only
            </label>
          )}
          <Button type="submit" style={{ padding: '6px 14px' }}>Search</Button>
          {filtered && <Button type="button" variant="ghost" style={{ padding: '6px 14px' }} onClick={clear}>Clear</Button>}
        </form>
        {filters.requestId && (
          <p className="ws-note">Showing everything from request <span className="ws-mono">{filters.requestId}</span>.</p>
        )}

        <Panel padded={false}>
          {!data ? (
            <div className="ws-panel-b">{[0, 1, 2, 3].map((i) => <Skeleton key={i} width={`${80 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table rows={rows} getRowKey={(r) => r.id} onRowClick={setOpen} columns={columnsFor(tab)}
              emptyText={filtered ? 'Nothing matches these filters.' : 'Nothing recorded yet.'} />
          )}
        </Panel>
        {data && data.total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <span className="ws-note">{data.total.toLocaleString()} record{data.total === 1 ? '' : 's'} · page {data.page} of {pages}</span>
            <Button variant="ghost" style={{ padding: '4px 10px' }} disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>Newer</Button>
            <Button variant="ghost" style={{ padding: '4px 10px' }} disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>Older</Button>
          </div>
        )}
        <p className="ws-note">
          Times are shown in your computer&apos;s time zone. Activity and data-viewed records are kept for the period set under
          Settings &amp; data; the record of changes is kept. Request bodies, passwords and link tokens are never recorded.
        </p>
      </div>

      {open && (
        <SidePanel eyebrow={TABS.find((t) => t.key === tab)?.label} title={open.action || 'Record'} onClose={() => setOpen(null)} wide>
          <Details tab={tab} row={open} onRequest={showRequest} />
        </SidePanel>
      )}
    </div>
  );
}
