import React, { useEffect, useMemo, useState } from 'react';
import { Mail, XCircle, Search } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import BoardView from './BoardView';
import Card from './Card';
import Button from './Button';
import Alert from './Alert';
import ReasonDialog from './ReasonDialog';
import BulkEmailComposer from './BulkEmailComposer';
import HireSection from './offers/HireSection';
import Modal from './Modal';
import { TagChips } from './TagEditor';

// One board for a vacancy across every stage (FR-ATS-042): Applied ->
// System shortlist -> Shortlisting by committee -> Approval by EXCO ->
// Interviews -> Offer -> Onboarding, plus Not progressing. A card's column
// comes from where the application really is, so the board can't drift
// from the record. Dragging moves a card only where one action does it
// (FR-ATS-043), and that action is the audited one used everywhere else:
//   any column -> Not progressing   rejects it (with a reason; the candidate is told)
//   Offer -> Onboarding              Mark as hired (with the signed appointing instrument)
// Every other move goes through its own step - committee, approvals, EXCO,
// interviews, merit list - because each has its own approver; dropping
// there says which step to use. Select cards to email them together
// (FR-ATS-050) or reject them together. Search filters by name, email or tag.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export const PIPELINE_COLUMNS = [
  { key: 'applied', label: 'Applied', color: 'var(--color-text-muted)' },
  { key: 'system', label: 'System shortlist', color: 'var(--color-primary)' },
  { key: 'committee', label: 'Shortlisting by committee', color: 'var(--color-primary)' },
  { key: 'exco', label: 'Approval by EXCO', color: 'var(--color-warning)' },
  { key: 'interviews', label: 'Interviews', color: 'var(--color-primary)' },
  { key: 'offer', label: 'Offer', color: 'var(--color-accent)' },
  { key: 'onboarding', label: 'Onboarding', color: 'var(--color-accent)' },
  { key: 'closed', label: 'Not progressing', color: 'var(--color-danger)' }
];

const WHERE_MOVES_HAPPEN = {
  system: 'Applications move here when HR runs Begin Review, which screens them.',
  committee: 'Applications go to the shortlisting committee from the Shortlist step.',
  exco: 'The interview shortlist goes to EXCO once a Principal HR Officer approves it (Shortlist step).',
  interviews: 'Candidates reach interviews once EXCO\'s signed approval is attached (Interviews step).',
  offer: 'Offers come from the approved merit list (Merit list & offers step).',
  onboarding: 'Only a candidate who accepted their offer can be marked hired.',
  applied: 'An application can\'t go back to Applied.'
};

/** Which column an application is in, from its record. */
export function pipelineColumn(app, committeeActive) {
  if (app.hire) return 'onboarding';
  if (['Rejected', 'Withdrawn'].includes(app.status)) return 'closed';
  if (app.status === 'Offered') return ['Declined', 'Expired', 'Withdrawn'].includes(app.offer?.status) ? 'closed' : 'offer';
  if (['InterviewScheduled', 'Interviewed'].includes(app.status)) return 'interviews';
  if (app.status === 'Shortlisted') return app.excoApprovalId || (app.interviewRounds || []).length ? 'interviews' : 'exco';
  if (app.status === 'ShortlistProposed') return 'committee';
  if (app.status === 'UnderReview') return committeeActive ? 'committee' : 'system';
  return 'applied';
}

export default function VacancyPipelineBoard({ vacancy, applications, staffRole, onUpdated, onGoToStage }) {
  const rank = ROLE_RANK[staffRole] || 0;
  const canAct = rank >= ROLE_RANK.Senior_HR_Officer;
  const [committeeActive, setCommitteeActive] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [rejecting, setRejecting] = useState(null); // [apps]
  const [hiring, setHiring] = useState(null);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    staffClient.get(`/api/shortlist-committee/vacancies/${vacancy.id}`)
      .then((res) => setCommitteeActive(['Rating', 'Moderation', 'Closed'].includes(res.data.exercise?.status)))
      .catch(() => {});
  }, [vacancy.id, applications]);

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase();
    if (!words) return applications;
    return applications.filter((a) => [a.candidate.fullName, a.candidate.email, ...(a.candidate.tags || []).map((t) => (t.tag || t).name)]
      .some((v) => String(v || '').toLowerCase().includes(words)));
  }, [applications, search]);
  const column = (a) => pipelineColumn(a, committeeActive);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedApps = applications.filter((a) => selected.includes(a.id));
  const rejectable = (a) => !['Draft', 'Offered', 'Rejected', 'Withdrawn'].includes(a.status);

  const onMove = (app, to) => {
    setError(''); setNotice('');
    if (to === 'closed') {
      if (!rejectable(app)) { setError(app.status === 'Offered' ? 'An offer is withdrawn from the offer itself, not by rejecting.' : 'This application is already closed.'); return; }
      setRejecting([app]);
      return;
    }
    if (to === 'onboarding' && column(app) === 'offer' && app.offer?.status === 'Accepted' && rank >= ROLE_RANK.Principal_HR_Officer) {
      setHiring(app);
      return;
    }
    setError(WHERE_MOVES_HAPPEN[to] || 'That move is made through its own step.');
  };

  const rejectAll = async (reason) => {
    const failures = [];
    for (const a of rejecting) {
      try {
        await staffClient.patch(`/api/applications/${a.id}/reject`, { reason });
      } catch (err) {
        failures.push(`${a.candidate.fullName}: ${err.response?.data?.error || 'failed'}`);
      }
    }
    const done = rejecting.length - failures.length;
    setRejecting(null); setSelected([]);
    setNotice(done ? `${done} application(s) marked not progressing; the candidates have been told.` : '');
    if (failures.length) setError(failures.join('; '));
    onUpdated?.();
  };

  const card = (a) => (
    <Card style={{ marginBottom: 0, padding: 10 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        {canAct && (
          <input type="checkbox" aria-label={`Select ${a.candidate.fullName}`} checked={selected.includes(a.id)}
            onChange={() => toggle(a.id)} onMouseDown={(e) => e.stopPropagation()} style={{ marginTop: 2 }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{a.candidate.fullName}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {a.candidate.candidateType}
            {a.committeeRank ? ` · committee #${a.committeeRank}` : ''}
            {a.meritRank ? ` · merit #${a.meritRank} ${a.meritListStatus || ''}` : ''}
            {a.offer?.status && column(a) === 'offer' ? ` · offer ${a.offer.status.toLowerCase()}` : ''}
            {a.hire ? ` · ${a.hire.caseRef}` : ''}
            {column(a) === 'closed' ? ` · ${a.status === 'Withdrawn' ? 'withdrew' : a.status === 'Offered' ? `offer ${a.offer?.status?.toLowerCase()}` : 'rejected'}` : ''}
          </div>
          {a.screeningPassed === false && <div style={{ fontSize: 11, color: 'var(--color-warning)' }}>&#9888; Flagged at screening</div>}
          {a.possibleDuplicates?.length > 0 && <div style={{ fontSize: 11, color: 'var(--color-danger)' }}>&#9888; Possible duplicate</div>}
          <div style={{ marginTop: 4 }}><TagChips tags={(a.candidate.tags || []).map((t) => t.tag || t)} /></div>
        </div>
      </div>
    </Card>
  );

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
        Every applicant, by where they are in the process. Drag a card to <strong>Not progressing</strong> to reject it, or an accepted offer
        to <strong>Onboarding</strong> to mark them hired; other moves happen in their own step (
        <button type="button" onClick={() => onGoToStage?.('shortlist')} style={{ all: 'unset', color: 'var(--color-primary)', cursor: 'pointer' }}>Shortlist</button>,{' '}
        <button type="button" onClick={() => onGoToStage?.('interviews')} style={{ all: 'unset', color: 'var(--color-primary)', cursor: 'pointer' }}>Interviews</button>,{' '}
        <button type="button" onClick={() => onGoToStage?.('merit')} style={{ all: 'unset', color: 'var(--color-primary)', cursor: 'pointer' }}>Merit list &amp; offers</button>
        ), where each has its approver.
      </p>
      <Alert type="error" message={error} />
      <Alert type="success" message={notice} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Search size={14} />
          <input aria-label="Search the board" placeholder="Name, email or tag" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, width: 220 }} />
        </span>
        {canAct && selected.length > 0 && (
          <>
            <strong style={{ fontSize: 13 }}>{selected.length} selected</strong>
            <Button style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setComposing(true)}><Mail size={14} /> Email</Button>
            <Button variant="ghost" style={{ padding: '4px 12px', fontSize: 13 }} disabled={!selectedApps.some(rejectable)}
              onClick={() => setRejecting(selectedApps.filter(rejectable))}><XCircle size={14} /> Not progressing</Button>
            <Button variant="ghost" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setSelected([])}>Clear</Button>
          </>
        )}
      </div>
      <BoardView columns={PIPELINE_COLUMNS} items={visible} groupBy={column} getItemKey={(a) => a.id} renderCard={card}
        onMove={canAct ? onMove : undefined} canDrag={(a) => column(a) !== 'onboarding' && column(a) !== 'closed'}
        emptyText="No applications yet." columnWidth={200} wrap />

      {rejecting && (
        <ReasonDialog title={rejecting.length === 1 ? `Not progressing - ${rejecting[0].candidate.fullName}` : `Not progressing - ${rejecting.length} applications`}
          intro="Each candidate is told their application was not successful. This can't be undone."
          label="Reason (kept on the record)" confirmLabel="Mark not progressing" danger
          onClose={() => setRejecting(null)} onSubmit={rejectAll} />
      )}
      {hiring && (
        <Modal title={`Mark ${hiring.candidate.fullName} as hired`} onClose={() => setHiring(null)}>
          <HireSection offer={hiring.offer} staffRole={staffRole} onChanged={() => { setHiring(null); onUpdated?.(); }} />
        </Modal>
      )}
      {composing && (
        <BulkEmailComposer applicationIds={selected} count={selected.length} onClose={() => setComposing(false)}
          onSent={(r) => { setComposing(false); setSelected([]); setNotice(`Email sent to ${r.sent}${r.failed ? `; ${r.failed} could not be sent` : ''}.`); }} />
      )}
    </div>
  );
}
