import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import staffClient from '../../models/staffApiClient';
import { refreshInbox } from '../../models/useInbox';
import HRSidebar from '../../components/HRSidebar';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import Skeleton from '../../components/Skeleton';
import ApproveNowBox from '../../components/ApproveNowBox';
import AuditTrail from '../../components/AuditTrail';
import OrgImportCard from '../../components/OrgImportCard';
import { PageTop, Panel, Table, Chips, SidePanel, KeyValues } from '../../components/workspace/ui';
import { downloadCsv } from '../../utils/csvDownload';
import { codeError } from '../../utils/orgFields';
import { POSITION_LEVELS, levelLabel } from '../../utils/positionLevels';
import {
  useOrgRights, useDeadlines, StatusPill, Due, RecordFacts, OrgItemActions, CodeAndName, STATUS_FILTERS, matches, countLabel
} from './orgShared';

// Positions (/hr/organisation/positions): every job in every department,
// with its short code (HRO), full title, level and approved headcount
// (FR-ATS-006). Anyone in HR adds one to an approved department; a
// Principal HR Officer or above approves it (or theirs is approved at once
// with "Approve now") and sets the headcount. A row opens it in a side
// panel: headcount, history, approve / edit / delete while no vacancy uses
// it. Positions from before codes have none until someone gives them one.

const emptyForm = { code: '', name: '', departmentId: '', level: 3 }; // Officer
const FILTERS = [...STATUS_FILTERS, { key: 'nocode', label: 'No code yet', test: (p) => !p.code }];

function PositionForm({ editing, presetDepartment, departments, isReviewer, onClose, onSaved }) {
  const [form, setForm] = useState(editing
    ? { code: editing.code || '', name: editing.name, departmentId: String(editing.departmentId), level: editing.level }
    : { ...emptyForm, departmentId: presetDepartment || '' });
  const [autoApprove, setAutoApprove] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // New positions go only into approved departments under approved directorates.
  // A department outside every directorate (directorate null) is usable once approved.
  const usable = departments.filter((d) => d.status === 'Approved' && (!d.directorate || d.directorate.status === 'Approved'));

  const submit = async (e) => {
    e.preventDefault();
    setShowErrors(true);
    if (codeError(form.code, 'position') || !form.name.trim() || !form.departmentId) return;
    setBusy(true); setError('');
    try {
      const body = { code: form.code, name: form.name, level: form.level };
      const res = editing
        ? await staffClient.patch(`/api/positions/${editing.id}`, body)
        : await staffClient.post('/api/positions', { ...body, departmentId: form.departmentId, ...(isReviewer ? { autoApprove } : {}) });
      onSaved(editing ? 'Title updated.' : res.data.autoApproved ? 'Title added and approved.'
        : `Title added. It waits for ${isReviewer ? 'another ' : 'a '}Principal HR Officer or above to approve it before it can be used.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the title');
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `Edit ${editing.name}` : 'Add a title'} onClose={onClose}>
      {!editing && !isReviewer && <p className="ws-note" style={{ marginTop: 0 }}>A Principal HR Officer approves a new title before it can be used on a vacancy.</p>}
      {editing && !editing.code && <Alert type="info" message="This title was added before short codes - give it one to save." />}
      <Alert type="error" message={error} />
      <form onSubmit={submit} noValidate>
        <CodeAndName form={form} setForm={setForm} word="title" showErrors={showErrors} nameLabel="Title"
          codePlaceholder="HRO" namePlaceholder="Human Resource Officer" codeHint="Unique in its department" />
        {editing ? (
          <KeyValues rows={[['Department', `${editing.department?.name} (${editing.department?.code})${editing.department?.directorate ? ` · ${editing.department.directorate.code}` : ''}`]]} />
        ) : (
          <Select label="Department" required value={form.departmentId} error={showErrors && !form.departmentId ? 'Choose its department' : null}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">Select a department</option>
            {usable.map((d) => <option key={d.id} value={d.id}>{d.directorate ? `${d.directorate.code} — ` : ''}{d.name} ({d.code})</option>)}
          </Select>
        )}
        <Select label="Level" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}>
          {POSITION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </Select>
        <p className="ws-note">From most junior (Officer) to most senior (Director). A vacancy's "Reports to" is chosen from more senior titles in the same department.</p>
        {!editing && isReviewer && <ApproveNowBox checked={autoApprove} onChange={setAutoApprove} what="title" />}
        {editing && <p className="ws-note">Changes are recorded in the audit log. Vacancies already raised keep the title they were advertised with.</p>}
        <Button type="submit" loading={busy} loadingText="Saving...">{editing ? 'Save changes' : 'Add title'}</Button>
      </form>
    </Modal>
  );
}

// A title's positions (the approved headcount - how many people the job is
// for), how many are filled, and so its vacancies (backend headcountService).
// A Principal HR Officer or above sets them.
const vacanciesOf = (p) => (p.headcount == null ? null : Math.max(0, p.headcount - (p.occupied || 0)));

function Headcount({ position, editable, onSaved }) {
  const [headcount, setHeadcount] = useState(position.headcount ?? '');
  const [occupied, setOccupied] = useState(position.occupied ?? 0);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setHeadcount(position.headcount ?? ''); setOccupied(position.occupied ?? 0);
    staffClient.get(`/api/positions/${position.id}/headcount`).then((res) => setInfo(res.data)).catch(() => setInfo(null));
  }, [position.id, position.headcount, position.occupied]);
  const changed = String(headcount) !== String(position.headcount ?? '') || String(occupied) !== String(position.occupied ?? 0);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const res = await staffClient.put(`/api/positions/${position.id}/headcount`, { headcount: headcount === '' ? null : Number(headcount), occupied: Number(occupied) || 0 });
      setInfo(res.data);
      onSaved('Headcount saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the headcount');
    } finally {
      setBusy(false);
    }
  };
  const input = { width: 90, height: 34, padding: '0 8px', border: '1px solid var(--color-border-strong)', borderRadius: 'var(--radius-sm)', font: 'inherit' };
  return (
    <div>
      <h3 style={{ fontSize: 14, margin: '20px 0 8px' }}>Positions and vacancies</h3>
      <p className="ws-note" style={{ marginTop: 0 }}>
        Positions: how many people this job is approved for. Filled: how many hold it now. Vacancies: the positions not filled.
        A recruitment asking for more people than there are vacancies not already being recruited for needs a reason and a
        Director's authorisation. Leave Positions empty where it isn't known - nothing is checked then. Mark as Hired adds one to Filled.
      </p>
      {editable ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="ws-note">Positions<br /><input type="number" min="0" style={input} value={headcount} placeholder="—" onChange={(e) => setHeadcount(e.target.value)} /></label>
          <label className="ws-note">Filled<br /><input type="number" min="0" style={input} value={occupied} onChange={(e) => setOccupied(e.target.value)} /></label>
          <span className="ws-note">Vacancies<br /><strong style={{ display: 'inline-block', height: 34, lineHeight: '34px' }}>{headcount === '' ? '—' : Math.max(0, Number(headcount) - (Number(occupied) || 0))}</strong></span>
          <Button variant="secondary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={!changed} loading={busy} loadingText="Saving..." onClick={save}>Save</Button>
        </div>
      ) : (
        <KeyValues rows={[['Positions', position.headcount ?? 'Not recorded'], ['Filled', position.occupied], ['Vacancies', vacanciesOf(position) ?? '—']]} />
      )}
      {error && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {info && info.headcount != null && (
        <p className="ws-note">Of the vacancies, {info.inRecruitment} {info.inRecruitment === 1 ? 'is' : 'are'} being recruited for and {info.available} {info.available === 1 ? 'is' : 'are'} not yet advertised.</p>
      )}
    </div>
  );
}

export default function PositionsPage() {
  const rights = useOrgRights();
  const deadlines = useDeadlines(rights.isReviewer);
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [directorates, setDirectorates] = useState([]);
  const [q, setQ] = useState(params.get('q') || '');
  const [directorate, setDirectorate] = useState(params.get('directorate') || '');
  const [department, setDepartment] = useState(params.get('department') || '');
  const [level, setLevel] = useState(params.get('level') || '');
  const [status, setStatus] = useState(params.get('status') || 'all');
  const [openId, setOpenId] = useState(Number(params.get('open')) || null);
  const [form, setForm] = useState(params.get('add') ? { editing: null } : null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0); // reloads the open item's history after a change

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (directorate) next.set('directorate', directorate);
    if (department) next.set('department', department);
    if (level) next.set('level', level);
    if (status !== 'all') next.set('status', status);
    if (openId) next.set('open', openId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, directorate, department, level, status, openId]);

  const load = useCallback(() => Promise.all([
    staffClient.get('/api/positions/admin').then((res) => setRows(res.data)),
    staffClient.get('/api/departments/admin').then((res) => setDepartments(res.data)),
    staffClient.get('/api/directorates').then((res) => setDirectorates(res.data))
  ]).catch((err) => { setRows((r) => r || []); setError(err.response?.data?.error || 'Could not load titles'); }), []);
  useEffect(() => { load(); }, [load]);

  const done = (text) => {
    setMessage(text); setError(''); setVersion((v) => v + 1);
    load(); deadlines.reload(); refreshInbox();
  };

  // A department picked under another directorate no longer applies.
  const departmentChoices = departments.filter((d) => !directorate || String(d.directorateId) === directorate);
  useEffect(() => {
    if (department && departments.length && !departmentChoices.some((d) => String(d.id) === department)) setDepartment('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directorate, departments]);

  const list = rows || [];
  const base = list.filter((p) => (!directorate || String(p.department?.directorateId) === directorate)
    && (!department || String(p.departmentId) === department)
    && (!level || String(p.level) === level)
    && matches(q, p.code, p.name, p.department?.code, p.department?.name, p.department?.directorate?.code));
  const filters = FILTERS.filter((f) => f.key !== 'nocode' || list.some(f.test));
  const filter = filters.find((f) => f.key === status) || filters[0];
  const shown = base.filter(filter.test);
  const open = list.find((p) => p.id === openId);

  const exportRows = () => downloadCsv(`titles-${new Date().toISOString().slice(0, 10)}.csv`, [
    { header: 'Code', value: (p) => p.code },
    { header: 'Title', value: (p) => p.name },
    { header: 'Level', value: (p) => levelLabel(p.level) },
    { header: 'Department code', value: (p) => p.department?.code },
    { header: 'Department', value: (p) => p.department?.name },
    { header: 'Directorate code', value: (p) => p.department?.directorate?.code },
    { header: 'Positions', value: (p) => p.headcount ?? '' },
    { header: 'Filled', value: (p) => p.occupied },
    { header: 'Vacancies', value: (p) => vacanciesOf(p) ?? '' },
    { header: 'Adverts raised', value: (p) => p.vacancyCount },
    { header: 'Status', value: (p) => p.status }
  ], shown);

  const blockedBy = open && [open.vacancyCount && countLabel(open.vacancyCount, 'advert'),
    open.reportingVacancyCount && `${countLabel(open.reportingVacancyCount, 'advert')} reporting to it`].filter(Boolean);
  const notUsable = open && open.status === 'Approved' && (open.department?.status !== 'Approved' || (open.department?.directorate && open.department.directorate.status !== 'Approved'));

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="org-positions" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          crumb={[{ label: 'Organisation', to: '/hr/organisation' }, { label: 'Titles' }]}
          title="Titles"
          subtitle="Every job title in every department: its short code, level, how many positions it has and how many are vacant"
          actions={<>
            <Button variant="ghost" disabled={!shown.length} onClick={exportRows}>Export</Button>
            <Button variant="ghost" onClick={() => setImporting(true)}>Import</Button>
            <Button onClick={() => setForm({ editing: null })}>+ Add title</Button>
          </>}
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />

        <div className="ws-toolbar">
          <input className="ws-field grow" placeholder="Code, title or department" aria-label="Search titles" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="ws-field" aria-label="Directorate" value={directorate} onChange={(e) => setDirectorate(e.target.value)}>
            <option value="">All directorates</option>
            {directorates.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
          </select>
          <select className="ws-field" aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departmentChoices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code}){directorate || !d.directorate ? '' : ` · ${d.directorate.code}`}</option>)}
          </select>
          <select className="ws-field" aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All levels</option>
            {POSITION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <Chips style={{ marginLeft: 'auto' }} value={filter.key} onChange={setStatus}
            options={filters.map((f) => ({ key: f.key, label: f.label, count: base.filter(f.test).length }))} />
        </div>

        <Panel padded={false}>
          {!rows ? (
            <div className="ws-panel-b">{[0, 1, 2, 3].map((i) => <Skeleton key={i} width={`${80 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table
              rows={shown}
              getRowKey={(p) => p.id}
              onRowClick={(p) => setOpenId(p.id)}
              emptyText={list.length ? 'No titles match.' : 'No titles yet. Add one, or import the organogram.'}
              columns={[
                { key: 'code', label: 'Code', width: 100, className: 'ws-mono', render: (p) => p.code || <span className="s">—</span> },
                { key: 'name', label: 'Title', render: (p) => <span className="t">{p.name}</span> },
                { key: 'level', label: 'Level', render: (p) => levelLabel(p.level) },
                { key: 'dept', label: 'Department', render: (p) => <>{p.department?.name}{p.department?.directorate && <span className="s"> · {p.department.directorate.code}</span>}</> },
                { key: 'headcount', label: 'Positions', align: 'right', className: 'ws-num', render: (p) => p.headcount ?? <span className="s">—</span> },
                { key: 'occupied', label: 'Filled', align: 'right', className: 'ws-num', render: (p) => (p.headcount == null ? <span className="s">—</span> : p.occupied) },
                { key: 'vacancies', label: 'Vacancies', align: 'right', className: 'ws-num', render: (p) => vacanciesOf(p) ?? <span className="s">—</span> },
                { key: 'adverts', label: 'Adverts', align: 'right', className: 'ws-num', render: (p) => p.vacancyCount },
                {
                  key: 'status', label: 'Status', render: (p) => (
                    <><StatusPill status={p.status} />{p.status === 'Pending' && <div><Due status={deadlines.deadlineOf('position', p.id)} /></div>}</>
                  )
                }
              ]}
            />
          )}
        </Panel>
        {rows && <div className="ws-note">{shown.length} of {countLabel(list.length, 'title')}</div>}
      </div>

      {open && (
        <SidePanel
          eyebrow={`Title · ${open.code || 'no code yet'}`}
          title={open.name}
          badges={<><StatusPill status={open.status} />{open.status === 'Pending' && <Due status={deadlines.deadlineOf('position', open.id)} />}</>}
          onClose={() => setOpenId(null)}
          footer={<OrgItemActions entity="position" row={open} rights={rights} inUse={blockedBy.length ? blockedBy.join(', ') : null}
            onEdit={() => setForm({ editing: open })}
            onDone={(text) => { if (/deleted|withdrawn/.test(text)) setOpenId(null); done(text); }}
            onError={setError} />}
        >
          {!open.code && <Alert type="info" message="This title has no short code yet - edit it to give it one." />}
          {notUsable && <Alert type="warning" message="Its department or directorate isn't approved, so it can't be used on a vacancy yet." />}
          <KeyValues rows={[
            ['Short code', open.code ? <span className="ws-mono">{open.code}</span> : null],
            ['Title', open.name],
            ['Level', levelLabel(open.level)],
            ['Department', open.department && <Link to={`/hr/organisation/departments?open=${open.department.id}`}>{open.department.name} ({open.department.code})</Link>],
            ['Directorate', open.department?.directorate && <Link to={`/hr/organisation/directorates?open=${open.department.directorate.id}`}>{open.department.directorate.name} ({open.department.directorate.code})</Link>],
            ['Adverts raised', open.vacancyCount],
            open.reportingVacancyCount > 0 && ['Adverts reporting to it', open.reportingVacancyCount]
          ]} />
          <RecordFacts row={open} />
          {open.status !== 'Rejected' && (
            <Headcount position={open} editable={rights.isReviewer} onSaved={done} />
          )}
          {blockedBy.length > 0 && rights.isReviewer && (
            <p className="ws-note">It can be deleted only when no advert uses it - it has {blockedBy.join(', ')}.</p>
          )}
          <AuditTrail key={`${open.id}-${version}`} entityType="Position" entityId={open.id} label="History" defaultOpen />
        </SidePanel>
      )}

      {form && (
        <PositionForm editing={form.editing} presetDepartment={department} departments={departments} isReviewer={rights.isReviewer}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); done(text); }} />
      )}

      {importing && (
        <Modal title="Import from a spreadsheet" onClose={() => setImporting(false)} maxWidth={860}
          footer={<Button variant="ghost" onClick={() => setImporting(false)}>Close</Button>}>
          <OrgImportCard canApprove={rights.isReviewer} onImported={() => done('Import finished.')} />
        </Modal>
      )}
    </div>
  );
}
