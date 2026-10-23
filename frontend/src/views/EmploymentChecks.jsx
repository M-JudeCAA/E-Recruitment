import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { refreshInbox } from '../models/useInbox';
import HRSidebar from '../components/HRSidebar';
import Alert from '../components/Alert';
import Button from '../components/Button';
import TextArea from '../components/TextArea';
import Skeleton from '../components/Skeleton';
import DocumentLink from '../components/DocumentLink';
import AuditTrail from '../components/AuditTrail';
import { PageTop, Panel, Table, Pill, Chips, SidePanel, KeyValues, formatDay, rankOf, ROLE_RANK } from '../components/workspace/ui';

// Employment checks (/hr/verification): internal candidates whose UCAA
// employment details wait for HR's check. They can't submit applications
// until verified (backend utils/employmentCheck.js), so HR works from here
// rather than from an application. A Senior HR Officer or above verifies or
// flags a discrepancy, with comments or the manager's recommendation letter
// (backend services/internalVerificationService.js); the candidate is told
// either way. Nobody sees or checks their own profile.

const STATUS = {
  Pending: { tone: 'warn', label: 'Waiting' },
  Discrepancy_Flagged: { tone: 'bad', label: 'Discrepancy' },
  HR_Verified: { tone: 'ok', label: 'Verified' }
};
const MIN_COMMENT = 20;
const SECTION = { fontSize: 14, margin: '20px 0 8px' };

function waitingFor(since) {
  const days = Math.floor((Date.now() - new Date(since)) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
}

function CheckPanel({ person, canDecide, onClose, onDecided }) {
  const [comments, setComments] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const enough = comments.trim().length >= MIN_COMMENT || Boolean(file);

  const decide = async (decision) => {
    setBusy(decision); setError('');
    try {
      const form = new FormData();
      form.append('decision', decision);
      if (comments.trim()) form.append('comments', comments.trim());
      if (file) form.append('recommendationLetter', file);
      await staffClient.patch(`/api/verification/candidates/${person.candidateId}/verify`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      onDecided(decision === 'HR_Verified'
        ? `${person.name}'s employment is verified. They have been told they can now apply.`
        : `A discrepancy is recorded for ${person.name}. They have been asked to check their details or contact HR.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the decision');
    } finally {
      setBusy(null);
    }
  };

  const status = STATUS[person.status] || STATUS.Pending;
  return (
    <SidePanel
      title={person.name}
      eyebrow="Employment check"
      badges={<Pill tone={status.tone}>{status.label}</Pill>}
      onClose={onClose}
      footer={canDecide && person.status !== 'HR_Verified' ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant="ghost" disabled={!enough || Boolean(busy)} loading={busy === 'Discrepancy_Flagged'} loadingText="Saving..."
            onClick={() => decide('Discrepancy_Flagged')}>Flag discrepancy</Button>
          <Button disabled={!enough || Boolean(busy)} loading={busy === 'HR_Verified'} loadingText="Saving..."
            onClick={() => decide('HR_Verified')}>Verify employment</Button>
        </div>
      ) : null}
    >
      <Alert type="error" message={error} />
      <h3 style={SECTION}>What they told us</h3>
      <KeyValues rows={[
        ['Email', person.email],
        ['Phone', person.phone],
        ['Department', person.department],
        ['Job title', person.position],
        ['Employee number', person.employeeId],
        ['Joined UCAA', person.dateJoined ? formatDay(person.dateJoined) : null],
        ['Waiting since', formatDay(person.waitingSince)]
      ]} />

      {person.applications.length > 0 && (
        <>
          <h3 style={SECTION}>Applications in progress</h3>
          <p className="ws-note" style={{ marginTop: 0 }}>Made before checks were required - they can't be shortlisted until this is verified.</p>
          <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 14 }}>
            {person.applications.map((a) => (
              <li key={a.id}><Link to={`/hr/vacancy/${a.vacancyId}?tab=applicants`}>{a.jobRef}</Link> · {a.title}</li>
            ))}
          </ul>
        </>
      )}

      {person.checkedAt && (
        <>
          <h3 style={SECTION}>Last check</h3>
          <KeyValues rows={[
            ['Decision', status.label],
            ['By', person.checkedBy],
            ['On', formatDay(person.checkedAt)],
            ['Comments', person.comments],
            ['Letter', person.supportingDocumentUrl ? <DocumentLink url={person.supportingDocumentUrl} name="Manager's recommendation letter" /> : null]
          ]} />
        </>
      )}

      {canDecide && person.status !== 'HR_Verified' ? (
        <>
          <h3 style={SECTION}>Your check</h3>
          <p className="ws-note" style={{ marginTop: 0 }}>
            Confirm the details against HR records (employee number, job title, date joined). Give comments (at least {MIN_COMMENT} characters) or attach
            the manager's recommendation letter - either is kept as the evidence.
          </p>
          <TextArea label="Comments" value={comments} onChange={(e) => setComments(e.target.value)} />
          <label className="ws-note" style={{ display: 'block', marginBottom: 4 }}>Manager's recommendation letter (PDF or Word)</label>
          <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} />
        </>
      ) : !canDecide ? (
        <p className="ws-note">A Senior HR Officer or above verifies employment.</p>
      ) : null}
      <AuditTrail entityType="InternalProfile" entityId={person.candidateId} label="History of checks" />
    </SidePanel>
  );
}

export default function EmploymentChecks() {
  const { staff } = useAuth();
  const canDecide = rankOf(staff?.role) >= ROLE_RANK.Senior_HR_Officer;
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('waiting');
  const [rows, setRows] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => staffClient.get('/api/verification/pending', { params: filter === 'all' ? { include: 'all' } : {} })
    .then((res) => { setRows(res.data); setError(''); })
    .catch((err) => { setRows([]); setError(err.response?.data?.error || 'Could not load the employment checks'); }), [filter]);
  useEffect(() => { load(); }, [load]);

  const openId = Number(params.get('open')) || null;
  const open = (rows || []).find((p) => p.candidateId === openId) || null;
  const setOpen = (id) => setParams(id ? { open: String(id) } : {}, { replace: true });

  const shown = (rows || []).filter((p) => (filter === 'flagged' ? p.status === 'Discrepancy_Flagged'
    : filter === 'waiting' ? p.status === 'Pending' : true));

  const columns = [
    { key: 'name', label: 'Candidate', render: (p) => <><span className="t">{p.name}</span><div className="s">{p.email}</div></> },
    { key: 'job', label: 'Department and job title', render: (p) => <><span>{p.department || '—'}</span><div className="s">{p.position || ''}</div></> },
    { key: 'employeeId', label: 'Employee number', render: (p) => <span className="s ws-mono">{p.employeeId || '—'}</span> },
    { key: 'status', label: 'Status', width: 120, render: (p) => { const s = STATUS[p.status] || STATUS.Pending; return <Pill tone={s.tone}>{s.label}</Pill>; } },
    { key: 'waiting', label: 'Waiting', width: 100, render: (p) => (p.status === 'HR_Verified' ? <span className="s">—</span> : waitingFor(p.waitingSince)) },
    { key: 'apps', label: 'Applications', width: 110, render: (p) => (p.applications.length ? <Pill tone="info">{p.applications.length} in progress</Pill> : <span className="s">None</span>) }
  ];

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="verification" />
      <div className="ws-page" style={{ flex: 1, minWidth: 0 }}>
        <PageTop
          title="Employment checks"
          subtitle="Internal candidates can submit applications only once HR has verified their UCAA employment details."
        />
        <Alert type="success" message={message} />
        <Alert type="error" message={error} />
        <Chips value={filter} onChange={setFilter} options={[
          { key: 'waiting', label: 'Waiting' },
          { key: 'flagged', label: 'Discrepancies' },
          { key: 'all', label: 'All internal candidates' }
        ]} />
        <Panel padded={false}>
          {!rows ? (
            <div className="ws-panel-b">{[0, 1, 2].map((i) => <Skeleton key={i} width={`${70 - i * 10}%`} height={14} style={{ marginBottom: 12 }} />)}</div>
          ) : (
            <Table rows={shown} getRowKey={(p) => p.candidateId} columns={columns} onRowClick={(p) => setOpen(p.candidateId)}
              emptyText={filter === 'waiting' ? 'Nobody is waiting for an employment check.' : 'Nothing to show.'} noun="candidates" />
          )}
        </Panel>
      </div>

      {open && (
        <CheckPanel person={open} canDecide={canDecide} onClose={() => setOpen(null)}
          onDecided={(text) => { setMessage(text); setOpen(null); load(); refreshInbox(); }} />
      )}
    </div>
  );
}
