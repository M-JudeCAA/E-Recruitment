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
import { PageTop, Panel, Table, Chips, SidePanel, KeyValues } from '../../components/workspace/ui';
import { downloadCsv } from '../../utils/csvDownload';
import { codeError } from '../../utils/orgFields';
import { levelLabel } from '../../utils/positionLevels';
import {
  useOrgRights, useDeadlines, StatusPill, Due, RecordFacts, OrgItemActions, CodeAndName, STATUS_FILTERS, matches, countLabel
} from './orgShared';

// Departments (/hr/organisation/departments): every department under its
// directorate, each with its short code (ARFFS) and full name, and what it
// holds - positions, staff accounts, vacancies. Anyone in HR adds one; a
// Principal HR Officer or above approves it (or theirs is approved at once
// with "Approve now"). A row opens it in a side panel: its positions, its
// history, approve / edit / move to another directorate / delete while
// nothing uses it.

const emptyForm = { code: '', name: '', directorateId: '' };

function DepartmentForm({ editing, presetDirectorate, directorates, isReviewer, onClose, onSaved }) {
  const [form, setForm] = useState(editing
    ? { code: editing.code, name: editing.name, directorateId: String(editing.directorateId) }
    : { ...emptyForm, directorateId: presetDirectorate || '' });
  const [autoApprove, setAutoApprove] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = directorates.filter((d) => d.status !== 'Rejected');

  const submit = async (e) => {
    e.preventDefault();
    setShowErrors(true);
    if (codeError(form.code, 'department') || !form.name.trim() || !form.directorateId) return;
    setBusy(true); setError('');
    try {
      const res = editing
        ? await staffClient.patch(`/api/departments/${editing.id}`, form)
        : await staffClient.post('/api/departments', { ...form, ...(isReviewer ? { autoApprove } : {}) });
      onSaved(editing ? 'Department updated.' : res.data.autoApproved ? 'Department added and approved.'
        : `Department added. It waits for ${isReviewer ? 'another ' : 'a '}Principal HR Officer or above to approve it before it can be used.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the department');
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `Edit ${editing.name}` : 'Add a department'} onClose={onClose}>
      {!editing && !isReviewer && <p className="ws-note" style={{ marginTop: 0 }}>A Principal HR Officer approves a new department before it can be used on a vacancy.</p>}
      <Alert type="error" message={error} />
      <form onSubmit={submit} noValidate>
        <CodeAndName form={form} setForm={setForm} word="department" showErrors={showErrors}
          codePlaceholder="ARFFS" namePlaceholder="Aerodrome Rescue and Fire Fighting Services" codeHint="Unique in its directorate" />
        <Select label="Directorate" required value={form.directorateId} error={showErrors && !form.directorateId ? 'Choose its directorate' : null}
          onChange={(e) => setForm({ ...form, directorateId: e.target.value })}>
          <option value="">Select a directorate</option>
          {choices.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}{d.status === 'Pending' ? ' (awaiting approval)' : ''}</option>)}
        </Select>
        {editing && String(editing.directorateId) !== form.directorateId && (
          <p className="ws-note">Moving it takes its positions with it. Vacancies already raised keep their department.</p>
        )}
        {!editing && isReviewer && <ApproveNowBox checked={autoApprove} onChange={setAutoApprove} what="department" />}
        {editing && <p className="ws-note">Changes are recorded in the audit log.</p>}
        <Button type="submit" loading={busy} loadingText="Saving...">{editing ? 'Save changes' : 'Add department'}</Button>
      </form>
    </Modal>
  );
}

export default function DepartmentsPage() {
  const rights = useOrgRights();
  const deadlines = useDeadlines(rights.isReviewer);
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [directorates, setDirectorates] = useState([]);
  const [positions, setPositions] = useState([]);
  const [q, setQ] = useState(params.get('q') || '');
  const [directorate, setDirectorate] = useState(params.get('directorate') || '');
  const [status, setStatus] = useState(params.get('status') || 'all');
  const [openId, setOpenId] = useState(Number(params.get('open')) || null);
  const [form, setForm] = useState(params.get('add') ? { editing: null } : null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0); // reloads the open item's history after a change

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (directorate) next.set('directorate', directorate);
    if (status !== 'all') next.set('status', status);
    if (openId) next.set('open', openId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, directorate, status, openId]);

  const load = useCallback(() => Promise.all([
    staffClient.get('/api/departments/admin').then((res) => setRows(res.data)),
    staffClient.get('/api/directorates').then((res) => setDirectorates(res.data)),
    staffClient.get('/api/positions/admin').then((res) => setPositions(res.data))
  ]).catch((err) => { setRows((r) => r || []); setError(err.response?.data?.error || 'Could not load departments'); }), []);
  useEffect(() => { load(); }, [load]);

  const done = (text) => {
    setMessage(text); setError(''); setVersion((v) => v + 1);
    load(); deadlines.reload(); refreshInbox();
  };

  const list = rows || [];
  const base = list.filter((d) => (!directorate || String(d.directorateId) === directorate)
    && matches(q, d.code, d.name, d.directorate?.code, d.directorate?.name));
  const filter = STATUS_FILTERS.find((f) => f.key === status) || STATUS_FILTERS[0];
  const shown = base.filter(filter.test);
  const open = list.find((d) => d.id === openId);
  const openPositions = open ? positions.filter((p) => p.departmentId === open.id) : [];

  const exportRows = () => downloadCsv(`departments-${new Date().toISOString().slice(0, 10)}.csv`, [
    { header: 'Code', value: (d) => d.code },
    { header: 'Name', value: (d) => d.name },
    { header: 'Directorate code', value: (d) => d.directorate?.code },
    { header: 'Directorate', value: (d) => d.directorate?.name },
    { header: 'Positions', value: (d) => d.positionCount },
    { header: 'Staff accounts', value: (d) => d.staffCount },
    { header: 'Vacancies', value: (d) => d.vacancyCount },
    { header: 'Status', value: (d) => d.status }
  ], shown);

  const inUse = open && [open.positionCount && countLabel(open.positionCount, 'position'), open.vacancyCount && countLabel(open.vacancyCount, 'vacancy', 'vacancies'),
    open.staffCount && countLabel(open.staffCount, 'staff account')].filter(Boolean);

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="org-departments" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          crumb={[{ label: 'Organisation', to: '/hr/organisation' }, { label: 'Departments' }]}
          title="Departments"
          subtitle="Every department under its directorate, with its short code, full name and what it holds"
          actions={<>
            <Button variant="ghost" disabled={!shown.length} onClick={exportRows}>Export</Button>
            <Button onClick={() => setForm({ editing: null })}>+ Add department</Button>
          </>}
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />

        <div className="ws-toolbar">
          <input className="ws-field grow" placeholder="Code or name" aria-label="Search departments" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="ws-field" aria-label="Directorate" value={directorate} onChange={(e) => setDirectorate(e.target.value)}>
            <option value="">All directorates</option>
            {directorates.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
          </select>
          <Chips style={{ marginLeft: 'auto' }} value={status} onChange={setStatus}
            options={STATUS_FILTERS.map((f) => ({ key: f.key, label: f.label, count: base.filter(f.test).length }))} />
        </div>

        <Panel padded={false}>
          {!rows ? (
            <div className="ws-panel-b">{[0, 1, 2, 3].map((i) => <Skeleton key={i} width={`${80 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table
              rows={shown}
              getRowKey={(d) => d.id}
              onRowClick={(d) => setOpenId(d.id)}
              emptyText={list.length ? 'No departments match.' : 'No departments yet. Add one, or import the organogram under Organisation.'}
              columns={[
                { key: 'code', label: 'Code', width: 110, className: 'ws-mono', render: (d) => d.code },
                { key: 'name', label: 'Name', render: (d) => <span className="t">{d.name}</span> },
                { key: 'dir', label: 'Directorate', render: (d) => <span title={d.directorate?.name}>{d.directorate?.code}</span> },
                { key: 'positions', label: 'Positions', align: 'right', className: 'ws-num', render: (d) => d.positionCount },
                { key: 'staff', label: 'Staff', align: 'right', className: 'ws-num', render: (d) => d.staffCount },
                { key: 'vacancies', label: 'Vacancies', align: 'right', className: 'ws-num', render: (d) => d.vacancyCount },
                {
                  key: 'status', label: 'Status', render: (d) => (
                    <><StatusPill status={d.status} />{d.status === 'Pending' && <div><Due status={deadlines.deadlineOf('department', d.id)} /></div>}</>
                  )
                }
              ]}
            />
          )}
        </Panel>
        {rows && <div className="ws-note">{shown.length} of {countLabel(list.length, 'department')}</div>}
      </div>

      {open && (
        <SidePanel
          eyebrow={`Department · ${open.code} · ${open.directorate?.code || ''}`}
          title={open.name}
          badges={<><StatusPill status={open.status} />{open.status === 'Pending' && <Due status={deadlines.deadlineOf('department', open.id)} />}</>}
          onClose={() => setOpenId(null)}
          footer={<OrgItemActions entity="department" row={open} rights={rights} inUse={inUse.length ? inUse.join(', ') : null}
            onEdit={() => setForm({ editing: open })}
            onDone={(text) => { if (/deleted|withdrawn/.test(text)) setOpenId(null); done(text); }}
            onError={setError} />}
        >
          <KeyValues rows={[
            ['Short code', <span className="ws-mono">{open.code}</span>],
            ['Full name', open.name],
            ['Directorate', open.directorate && <Link to={`/hr/organisation/directorates?open=${open.directorate.id}`}>{open.directorate.name} ({open.directorate.code})</Link>],
            ['Staff accounts', open.staffCount],
            ['Vacancies raised', open.vacancyCount]
          ]} />
          <RecordFacts row={open} />
          {open.directorate && open.directorate.status !== 'Approved' && (
            <Alert type="warning" message={`Its directorate is ${open.directorate.status === 'Pending' ? 'still waiting for approval' : 'rejected'} - its positions can't be used on a vacancy until the directorate is approved.`} />
          )}

          <h3 style={{ fontSize: 14, margin: '20px 0 8px' }}>Positions</h3>
          {openPositions.length === 0 ? <p className="ws-note">None yet.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {[...openPositions].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)).map((p) => (
                <li key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span className="ws-mono" style={{ minWidth: 60 }}>{p.code || '—'}</span>
                  <Link to={`/hr/organisation/positions?open=${p.id}`} style={{ flex: 1, minWidth: 0 }}>{p.name}</Link>
                  <span className="ws-note">{levelLabel(p.level)}</span>
                  {p.status !== 'Approved' && <StatusPill status={p.status} />}
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Link to={`/hr/organisation/positions?department=${open.id}`}>Open its positions</Link>
            {open.status === 'Approved' && <Link to={`/hr/organisation/positions?department=${open.id}&add=1`}>Add a position here</Link>}
          </p>
          {inUse.length > 0 && rights.isReviewer && (
            <p className="ws-note">It can be deleted only when nothing uses it - it has {inUse.join(', ')}.</p>
          )}

          <AuditTrail key={`${open.id}-${version}`} entityType="Department" entityId={open.id} label="History" defaultOpen />
        </SidePanel>
      )}

      {form && (
        <DepartmentForm editing={form.editing} presetDirectorate={directorate} directorates={directorates} isReviewer={rights.isReviewer}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); done(text); }} />
      )}
    </div>
  );
}
