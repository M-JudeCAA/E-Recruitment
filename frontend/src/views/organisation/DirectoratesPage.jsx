import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import staffClient from '../../models/staffApiClient';
import { refreshInbox } from '../../models/useInbox';
import HRSidebar from '../../components/HRSidebar';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Modal from '../../components/Modal';
import TextField from '../../components/TextField';
import Skeleton from '../../components/Skeleton';
import ApproveNowBox from '../../components/ApproveNowBox';
import AuditTrail from '../../components/AuditTrail';
import { PageTop, Panel, Table, Chips, SidePanel, KeyValues } from '../../components/workspace/ui';
import { downloadCsv } from '../../utils/csvDownload';
import { codeError } from '../../utils/orgFields';
import {
  useOrgRights, useDeadlines, StatusPill, Due, RecordFacts, OrgItemActions, CodeAndName, STATUS_FILTERS, matches, countLabel
} from './orgShared';

// Directorates (/hr/organisation/directorates): the top level of the
// organisation, each with its short code (DHRA), full name and director.
// Adding one is Principal HR Officer and above; a row opens it in a side
// panel with its departments, its history and what can be done with it
// (approve, edit, delete while it has no departments).

const emptyForm = { code: '', name: '', directorName: '', directorEmail: '' };

function DirectorateForm({ editing, isReviewer, onClose, onSaved }) {
  const [form, setForm] = useState(editing
    ? { code: editing.code, name: editing.name, directorName: editing.directorName || '', directorEmail: editing.directorEmail || '' }
    : emptyForm);
  const [autoApprove, setAutoApprove] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setShowErrors(true);
    if (codeError(form.code, 'directorate') || !form.name.trim()) return;
    setBusy(true); setError('');
    try {
      const res = editing
        ? await staffClient.patch(`/api/directorates/${editing.id}`, form)
        : await staffClient.post('/api/directorates', { ...form, autoApprove });
      onSaved(editing ? 'Directorate updated.' : res.data.autoApproved ? 'Directorate added and approved.'
        : 'Directorate added. It waits for another Principal HR Officer or above to approve it.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the directorate');
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `Edit ${editing.name}` : 'Add a directorate'} onClose={onClose}>
      {!editing && <p className="ws-note" style={{ marginTop: 0 }}>Directorates rarely change. Principal HR Officer and above.</p>}
      <Alert type="error" message={error} />
      <form onSubmit={submit} noValidate>
        <CodeAndName form={form} setForm={setForm} word="directorate" showErrors={showErrors}
          codePlaceholder="DHRA" namePlaceholder="Human Resource and Administration" codeHint="As used inside UCAA" />
        <TextField label="Director's name (optional)" value={form.directorName} onChange={(e) => setForm({ ...form, directorName: e.target.value })} />
        <TextField label="Director's email (optional)" type="email" value={form.directorEmail} onChange={(e) => setForm({ ...form, directorEmail: e.target.value })} />
        {!editing && isReviewer && <ApproveNowBox checked={autoApprove} onChange={setAutoApprove} what="directorate" />}
        {editing && <p className="ws-note">Changes are recorded in the audit log. Vacancies already raised keep their department.</p>}
        <Button type="submit" loading={busy} loadingText="Saving...">{editing ? 'Save changes' : 'Add directorate'}</Button>
      </form>
    </Modal>
  );
}

export default function DirectoratesPage() {
  const rights = useOrgRights();
  const deadlines = useDeadlines(rights.isReviewer);
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [q, setQ] = useState(params.get('q') || '');
  const [status, setStatus] = useState(params.get('status') || 'all');
  const [openId, setOpenId] = useState(Number(params.get('open')) || null);
  const [form, setForm] = useState(params.get('add') ? { editing: null } : null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0); // reloads the open item's history after a change

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (status !== 'all') next.set('status', status);
    if (openId) next.set('open', openId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, openId]);

  const load = useCallback(() => Promise.all([
    staffClient.get('/api/directorates').then((res) => setRows(res.data)),
    staffClient.get('/api/departments/admin').then((res) => setDepartments(res.data))
  ]).catch((err) => { setRows((r) => r || []); setError(err.response?.data?.error || 'Could not load directorates'); }), []);
  useEffect(() => { load(); }, [load]);

  const done = (text) => {
    setMessage(text); setError(''); setVersion((v) => v + 1);
    load(); deadlines.reload(); refreshInbox();
  };

  const list = rows || [];
  const base = list.filter((d) => matches(q, d.code, d.name, d.directorName));
  const filter = STATUS_FILTERS.find((f) => f.key === status) || STATUS_FILTERS[0];
  const shown = base.filter(filter.test);
  const open = list.find((d) => d.id === openId);
  const openDepartments = open ? departments.filter((d) => d.directorateId === open.id) : [];

  const exportRows = () => downloadCsv(`directorates-${new Date().toISOString().slice(0, 10)}.csv`, [
    { header: 'Code', value: (d) => d.code },
    { header: 'Name', value: (d) => d.name },
    { header: 'Director', value: (d) => d.directorName },
    { header: "Director's email", value: (d) => d.directorEmail },
    { header: 'Departments', value: (d) => d.departmentCount },
    { header: 'Positions', value: (d) => d.positionCount },
    { header: 'Status', value: (d) => d.status }
  ], shown);

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="org-directorates" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          crumb={[{ label: 'Organisation', to: '/hr/organisation' }, { label: 'Directorates' }]}
          title="Directorates"
          subtitle="The top level of the organisation, each with its short code, full name and director"
          actions={<>
            <Button variant="ghost" disabled={!shown.length} onClick={exportRows}>Export</Button>
            {rights.isReviewer && <Button onClick={() => setForm({ editing: null })}>+ Add directorate</Button>}
          </>}
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />

        <div className="ws-toolbar">
          <input className="ws-field grow" placeholder="Code, name or director" aria-label="Search directorates" value={q} onChange={(e) => setQ(e.target.value)} />
          <Chips style={{ marginLeft: 'auto' }} value={status} onChange={setStatus}
            options={STATUS_FILTERS.map((f) => ({ key: f.key, label: f.label, count: base.filter(f.test).length }))} />
        </div>

        <Panel padded={false}>
          {!rows ? (
            <div className="ws-panel-b">{[0, 1, 2].map((i) => <Skeleton key={i} width={`${70 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table
              rows={shown}
              getRowKey={(d) => d.id}
              onRowClick={(d) => setOpenId(d.id)}
              emptyText={list.length ? 'No directorates match.' : 'No directorates yet. Add one, or import the organogram under Organisation.'}
              columns={[
                { key: 'code', label: 'Code', width: 110, className: 'ws-mono', render: (d) => d.code },
                { key: 'name', label: 'Name', render: (d) => <><span className="t">{d.name}</span>{d.directorName && <div className="s">{d.directorName}</div>}</> },
                { key: 'depts', label: 'Departments', align: 'right', className: 'ws-num', render: (d) => d.departmentCount },
                { key: 'positions', label: 'Positions', align: 'right', className: 'ws-num', render: (d) => d.positionCount },
                {
                  key: 'status', label: 'Status', render: (d) => (
                    <><StatusPill status={d.status} />{d.status === 'Pending' && <div><Due status={deadlines.deadlineOf('directorate', d.id)} /></div>}</>
                  )
                }
              ]}
            />
          )}
        </Panel>
        {rows && <div className="ws-note">{shown.length} of {countLabel(list.length, 'directorate')}</div>}
      </div>

      {open && (
        <SidePanel
          eyebrow={`Directorate · ${open.code}`}
          title={open.name}
          badges={<><StatusPill status={open.status} />{open.status === 'Pending' && <Due status={deadlines.deadlineOf('directorate', open.id)} />}</>}
          onClose={() => setOpenId(null)}
          footer={<OrgItemActions entity="directorate" row={open} rights={rights} inUse={open.departmentCount ? countLabel(open.departmentCount, 'department') : null}
            onEdit={() => setForm({ editing: open })}
            onDone={(text) => { if (/deleted|withdrawn/.test(text)) setOpenId(null); done(text); }}
            onError={setError} />}
        >
          <KeyValues rows={[
            ['Short code', <span className="ws-mono">{open.code}</span>],
            ['Full name', open.name],
            ['Director', open.directorName],
            ["Director's email", open.directorEmail],
            ['Departments', open.departmentCount],
            ['Positions', open.positionCount]
          ]} />
          <RecordFacts row={open} />

          <h3 style={{ fontSize: 14, margin: '20px 0 8px' }}>Departments</h3>
          {openDepartments.length === 0 ? <p className="ws-note">None yet.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {openDepartments.map((d) => (
                <li key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span className="ws-mono" style={{ minWidth: 70 }}>{d.code}</span>
                  <Link to={`/hr/organisation/departments?open=${d.id}`} style={{ flex: 1, minWidth: 0 }}>{d.name}</Link>
                  <span className="ws-note">{countLabel(d.positionCount, 'position')}</span>
                  {d.status !== 'Approved' && <StatusPill status={d.status} />}
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginTop: 10 }}><Link to={`/hr/organisation/departments?directorate=${open.id}`}>Open its departments</Link></p>
          {open.departmentCount > 0 && rights.isReviewer && (
            <p className="ws-note">It can be deleted only once it has no departments.</p>
          )}

          <AuditTrail key={`${open.id}-${version}`} entityType="Directorate" entityId={open.id} label="History" defaultOpen />
        </SidePanel>
      )}

      {form && (
        <DirectorateForm editing={form.editing} isReviewer={rights.isReviewer}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); done(text); }} />
      )}
    </div>
  );
}
