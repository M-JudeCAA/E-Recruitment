import React, { useMemo, useRef, useState } from 'react';
import {
  Search, GripVertical, ChevronUp, ChevronDown, ArrowRightLeft, Users, Lock,
  CheckCircle2, Clock, Scale, X, ArrowRight, Sparkles
} from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Card from './Card';
import Button from './Button';
import Modal from './Modal';
import TextField from './TextField';
import Avatar from './Avatar';
import ProgressRing from './ProgressRing';
import StatusBadge from './StatusBadge';
import ApplicationReviewCard from './ApplicationReviewCard';
import { safeJsonParse } from '../utils/safeJsonParse';

// ===========================================================================
// Step one of selection: the interview shortlist - WHO gets interviewed, in
// what order. Five columns, each with exactly one meaning, so a card's
// column IS its state:
//
//   Applicant pool (screened, not shortlisted) -> Interview shortlist
//   (staged locally, only persisted on "Propose interview shortlist") ->
//   Interviewing (approved, interview booked or pending) -> Interviewed
//   (verdict in, heading for the merit list) -> Decided (terminal).
//
// There is no Primary/Reserve here any more: before an interview nobody
// knows who the best candidate is. That is decided afterwards, from the
// interview results, on the merit list (MeritListBoard.jsx). The shortlist
// column stays draggable once proposed (re-ordering demotes it back to
// ShortlistProposed for re-approval, as the backend does) - a per-card pill
// shows what is actually persisted vs. what is staged locally. "Propose"
// calls POST /vacancies/:id/rank with the order.
// ===========================================================================

// Interview more candidates than there are posts, so the merit list has
// reserves to fall back on - a hint, not a rule.
const SUGGESTED_INTERVIEWS_PER_POSITION = 3;

function scoreTier(score) {
  if (score == null) return 'var(--color-text-muted)';
  if (score >= 10) return 'var(--color-accent)';
  if (score >= 4) return 'var(--color-warning)';
  return 'var(--color-text-muted)';
}

function essentialSummary(app) {
  const results = safeJsonParse(app.essentialCriteriaResults, []);
  if (results.length === 0) return null;
  const met = results.filter((r) => r.met).length;
  return { met, total: results.length };
}

// Truth pill for a shortlist card - always reflects what's actually
// persisted server-side, independent of where the card currently sits in
// this session's unsaved local arrangement.
function PersistedStatusPill({ status }) {
  const map = {
    UnderReview: { label: 'Not yet proposed', color: 'var(--color-text-muted)', Icon: Clock },
    Submitted: { label: 'Awaiting screening', color: 'var(--color-text-muted)', Icon: Lock },
    ShortlistProposed: { label: 'Proposed - awaiting approval', color: 'var(--color-warning)', Icon: Clock },
    Shortlisted: { label: 'Approved', color: 'var(--color-accent)', Icon: CheckCircle2 }
  };
  const entry = map[status];
  if (!entry) return null;
  const { label, color, Icon } = entry;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color }}>
      <Icon size={11} /> {label}
    </span>
  );
}

function VerificationChip({ app }) {
  if (app.candidate.candidateType !== 'Internal') return null;
  const status = app.candidate.internalProfile?.verificationStatus;
  const colorMap = { HR_Verified: 'var(--color-accent)', Discrepancy_Flagged: 'var(--color-danger)' };
  const color = colorMap[status] || 'var(--color-warning)';
  const label = status === 'HR_Verified' ? 'Verified' : status === 'Discrepancy_Flagged' ? 'Discrepancy' : 'Unverified';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
      color, border: `1px solid ${color}`, whiteSpace: 'nowrap'
    }}>
      {label}
    </span>
  );
}

// One card. draggable is false for Interview/Decided (view-only there) -
// every interactive affordance (move buttons, drag handle, compare
// checkbox) is simply omitted rather than disabled, so those columns read
// as calm/settled at a glance, not "temporarily locked".
function PipelineCard({
  app, draggable, onDragStart, onDragOver, onDrop, onDragEnd, isDragging, isOver,
  onOpen, onMoveUp, onMoveDown, onQuickMove, quickMoveTargets, compareMode, compareSelected, onToggleCompare
}) {
  // Reorder buttons only make sense in the shortlist, where position is a
  // manual choice - Pool is always score-sorted, so onMoveUp is undefined
  // there and the buttons are simply omitted rather than shown inert.
  const showReorder = !!(onMoveUp && onMoveDown);
  const essentials = essentialSummary(app);
  const locked = app.status === 'Submitted';
  return (
    <div
      data-testid={`pipeline-card-${app.id}`}
      draggable={draggable && !locked}
      onDragStart={draggable && !locked ? onDragStart : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        opacity: isDragging ? 0.4 : 1,
        transform: isOver ? 'translateY(2px)' : 'none',
        transition: 'opacity 0.15s ease, transform 0.1s ease'
      }}
    >
      <Card
        onClick={() => !compareMode && onOpen(app)}
        style={{
          marginBottom: 8, padding: 10, cursor: compareMode ? 'default' : 'pointer',
          borderLeft: isOver ? '4px solid var(--color-primary)' : locked ? '4px solid var(--color-border)' : '4px solid transparent',
          background: locked ? 'var(--color-bg-subtle)' : 'var(--color-bg)',
          boxShadow: isOver ? '0 0 0 2px var(--color-primary-light)' : undefined
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {draggable && !locked && (
            <span style={{ color: 'var(--color-text-muted)', cursor: 'grab', paddingTop: 6, flexShrink: 0 }}>
              <GripVertical size={14} />
            </span>
          )}
          {compareMode && (
            <input
              type="checkbox" checked={compareSelected} onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleCompare(app.id)} style={{ marginTop: 8, flexShrink: 0 }}
            />
          )}
          <Avatar name={app.candidate.fullName} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {app.candidate.fullName}
              </strong>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '0 5px' }}>
                {app.candidate.candidateType}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              {app.shortlistScore != null && (
                <span title={safeJsonParse(app.shortlistScoreReasons, []).join('; ') || 'No scoring factors applied'}
                  style={{ fontSize: 11, fontWeight: 700, color: scoreTier(app.shortlistScore) }}>
                  ★ {app.shortlistScore.toFixed(1)}
                </span>
              )}
              {essentials && (
                <span style={{ fontSize: 11, color: essentials.met === essentials.total ? 'var(--color-accent)' : 'var(--color-warning)' }}>
                  {essentials.met}/{essentials.total} essentials
                </span>
              )}
              <VerificationChip app={app} />
              {app.possibleDuplicates?.length > 0 && (
                <span title={`Same phone number as ${app.possibleDuplicates.map((d) => `${d.candidateName} (#${d.applicationId})`).join(', ')}`}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-danger)' }}>
                  &#9888; Possible duplicate
                </span>
              )}
            </div>
            {(app.status === 'UnderReview' || app.status === 'Submitted' || app.status === 'ShortlistProposed' || app.status === 'Shortlisted') && (
              <div style={{ marginTop: 3 }}><PersistedStatusPill status={app.status} /></div>
            )}
            {['Shortlisted', 'InterviewScheduled', 'Interviewed'].includes(app.status) && (
              <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <StatusBadge status={app.status} />
                {app.interviewRounds?.length > 0 && (() => {
                  const latest = [...app.interviewRounds].sort((a, b) => b.roundNumber - a.roundNumber)[0];
                  return latest.recommendation ? <StatusBadge status={latest.recommendation} /> : null;
                })()}
                {app.meritListStatus && <StatusBadge status={app.meritListStatus} label={`Merit #${app.meritRank}`} />}
              </div>
            )}
            {['Offered', 'Rejected', 'Withdrawn'].includes(app.status) && (
              <div style={{ marginTop: 3 }}><StatusBadge status={app.status} /></div>
            )}
          </div>
        </div>

        {draggable && !locked && !compareMode && (showReorder || quickMoveTargets.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, paddingLeft: 22 }} onClick={(e) => e.stopPropagation()}>
            {showReorder && (
              <>
                <button type="button" onClick={onMoveUp} aria-label="Move up"
                  style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: '1px 3px', color: 'var(--color-text-muted)' }}>
                  <ChevronUp size={12} />
                </button>
                <button type="button" onClick={onMoveDown} aria-label="Move down"
                  style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: '1px 3px', color: 'var(--color-text-muted)' }}>
                  <ChevronDown size={12} />
                </button>
              </>
            )}
            {quickMoveTargets.map((t) => (
              <button key={t.key} type="button" onClick={() => onQuickMove(t.key)}
                style={{
                  background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer',
                  padding: '1px 6px', fontSize: 10, color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 3
                }}>
                <ArrowRightLeft size={10} /> {t.label}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ColumnShell({ title, count, accent, children, headerExtra, onDragOver, onDrop, isOver, muted }) {
  return (
    <div
      data-testid={`column-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        flex: '0 0 270px', display: 'flex', flexDirection: 'column',
        background: isOver ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)',
        borderRadius: 'var(--radius)', padding: 8, maxHeight: 640,
        transition: 'background-color 0.15s ease', opacity: muted ? 0.75 : 1
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <strong style={{ fontSize: 13 }}>{title}</strong>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>{count}</span>
        </div>
        {headerExtra}
      </div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 60, paddingBottom: 4 }}>
        {children}
      </div>
    </div>
  );
}

function CompareDrawer({ apps, onClose }) {
  const rows = [
    { label: 'Score', get: (a) => a.shortlistScore != null ? a.shortlistScore.toFixed(1) : '—' },
    { label: 'Candidate type', get: (a) => a.candidate.candidateType },
    {
      label: 'Essential requirements', get: (a) => {
        const s = essentialSummary(a);
        return s ? `${s.met}/${s.total} met` : '—';
      }
    },
    {
      label: 'Desirable requirements', get: (a) => {
        const responses = a.desirableResponses || [];
        if (responses.length === 0) return '—';
        const met = responses.filter((r) => r.answerType === 'number' ? r.answer >= r.minValue : r.answer === true).length;
        return `${met}/${responses.length} met`;
      }
    },
    { label: 'Screening', get: (a) => a.screeningPassed === false ? 'Flagged' : a.screeningPassed === true ? 'Meets criteria' : 'Not yet screened' },
    { label: 'Verification', get: (a) => a.candidate.candidateType === 'Internal' ? (a.candidate.internalProfile?.verificationStatus || 'Pending').replace(/_/g, ' ') : 'N/A (external)' },
    { label: 'Status', get: (a) => a.status.replace(/([a-z])([A-Z])/g, '$1 $2') }
  ];
  return (
    <Modal title="Compare candidates" onClose={onClose} maxWidth={Math.min(900, 260 + apps.length * 200)}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid var(--color-border)' }} />
              {apps.map((a) => (
                <th key={a.id} style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid var(--color-border)', minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Avatar name={a.candidate.fullName} size={24} />
                    {a.candidate.fullName}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ padding: 8, borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.label}</td>
                {apps.map((a) => (
                  <td key={a.id} style={{ padding: 8, borderBottom: '1px solid var(--color-border)' }}>{r.get(a)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// vacancy: full vacancy row (needs id, positionsRequired). applications:
// every application for this vacancy (findByVacancy shape - candidate,
// interviewRounds, offer, rejectedBy included). staffRole: current staff
// user's role string. onUpdated: parent's refetch (loadVacancyMode).
// onDownloadCv/downloadingId: passed through from the parent's single
// useGeneratedCvDownload instance, so this board doesn't spin up a second
// hidden print area of its own.
export default function ShortlistPipelineBoard({ vacancy, applications, staffRole, onUpdated, onDownloadCv, downloadingId, onGoToStage, committeeManaged = false }) {
  const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
  const rank = ROLE_RANK[staffRole] || 0;
  // A committee-run vacancy takes its shortlist from the committee's ranking
  // (ShortlistCommittee.jsx) - no hand-ranking here.
  const canRank = rank >= ROLE_RANK.Senior_HR_Officer && !committeeManaged;
  const canApprove = rank >= ROLE_RANK.Principal_HR_Officer;

  const byId = useMemo(() => Object.fromEntries(applications.map((a) => [a.id, a])), [applications]);
  const avgScore = useMemo(() => {
    const scored = applications.filter((a) => a.shortlistScore != null);
    return scored.length ? scored.reduce((s, a) => s + a.shortlistScore, 0) / scored.length : null;
  }, [applications]);

  // Local staged arrangement - seeded from the last-known committed
  // rank/listStatus, then mutated purely client-side by drag/quick-move
  // until "Propose shortlist" persists it. Re-seeds whenever `applications`
  // changes UNLESS the user has unsaved local moves in progress (isDirty),
  // so a live WS refresh from someone else's action never silently wipes
  // out an in-progress drag arrangement.
  const seedStaging = (apps) => ({
    shortlist: apps.filter((a) => a.rank != null && ['UnderReview', 'ShortlistProposed'].includes(a.status))
      .sort((a, b) => a.rank - b.rank).map((a) => a.id)
  });

  const [staging, setStaging] = useState(() => seedStaging(applications));
  const [isDirty, setIsDirty] = useState(false);
  // True once a live update (someone else's action, via the parent's WS
  // refetch) arrives while this session has an unsaved local arrangement -
  // surfaced as a dismissible banner rather than silently discarding
  // whatever the user was mid-drag on.
  const [staleWhileEditing, setStaleWhileEditing] = useState(false);
  const lastAppsRef = useRef(applications);
  // Derived-state-during-render pattern (React-sanctioned for exactly this
  // "reset local state when a prop identity changes" case) - re-seeds the
  // staged arrangement from the freshest server data whenever `applications`
  // changes, but only while there's nothing unsaved to lose.
  if (lastAppsRef.current !== applications) {
    lastAppsRef.current = applications;
    if (!isDirty) {
      const fresh = seedStaging(applications);
      if (JSON.stringify(fresh) !== JSON.stringify(staging)) setStaging(fresh);
    } else {
      setStaleWhileEditing(true);
    }
  }

  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(null); // { id, from }
  const [dragOver, setDragOver] = useState(null); // column key, or `${column}:${index}`
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  // Doubles as the compare-drawer flag via the '__compare__' sentinel,
  // rather than a second boolean - only one of {detail modal, compare
  // drawer} is ever open at once, so one piece of state is enough.
  const [detailApp, setDetailApp] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [decidedOpen, setDecidedOpen] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  const showToast = (message, undoFn) => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, undo: undoFn });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  };

  const pushHistory = () => setHistory((h) => [...h.slice(-9), staging]);
  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setStaging(h[h.length - 1]);
      return h.slice(0, -1);
    });
    setToast(null);
  };

  const matches = (app) => !search.trim() || app.candidate.fullName.toLowerCase().includes(search.trim().toLowerCase());

  const poolApps = applications
    .filter((a) => (a.status === 'UnderReview' && a.rank == null) || a.status === 'Submitted')
    .filter((a) => !staging.shortlist.includes(a.id))
    .filter(matches)
    .sort((a, b) => (a.status === 'Submitted' ? 1 : 0) - (b.status === 'Submitted' ? 1 : 0) || (b.shortlistScore ?? -Infinity) - (a.shortlistScore ?? -Infinity));

  const interviewingApps = applications.filter((a) => ['Shortlisted', 'InterviewScheduled'].includes(a.status)).filter(matches);
  const interviewedApps = applications.filter((a) => a.status === 'Interviewed').filter(matches)
    .sort((a, b) => (a.meritRank ?? 1e9) - (b.meritRank ?? 1e9));
  const decidedApps = applications.filter((a) => ['Offered', 'Rejected', 'Withdrawn'].includes(a.status)).filter(matches);

  const shortlistApps = staging.shortlist.map((id) => byId[id]).filter(Boolean).filter(matches);
  const suggestedSize = vacancy.positionsRequired * SUGGESTED_INTERVIEWS_PER_POSITION;

  const hasProposedAwaitingApproval = staging.shortlist.some((id) => byId[id]?.status === 'ShortlistProposed');

  // --- drag/move mechanics ---
  const removeFromStaging = (id) => ({ shortlist: staging.shortlist.filter((x) => x !== id) });

  const applyMove = (id, targetCol, targetIndex) => {
    pushHistory();
    const next = removeFromStaging(id);
    if (targetCol === 'shortlist') {
      // No explicit drop index (quick-move button) appends to the end.
      const idx = targetIndex != null ? Math.min(targetIndex, next.shortlist.length) : next.shortlist.length;
      next.shortlist.splice(idx, 0, id);
      const wasProposed = byId[id]?.status === 'ShortlistProposed';
      showToast(
        `${byId[id]?.candidate.fullName || 'Candidate'} added to the interview shortlist` +
          (wasProposed ? ' - re-propose to update the pending approval.' : '.'),
        undo
      );
    } else {
      showToast(`${byId[id]?.candidate.fullName || 'Candidate'} returned to the pool.`, undo);
    }
    setStaging(next);
    setIsDirty(true);
  };

  const onCardDragStart = (id, from) => (e) => {
    setDragging({ id, from });
    e.dataTransfer.effectAllowed = 'move';
  };
  const onCardDragEnd = () => { setDragging(null); setDragOver(null); };
  const onCardDragOver = (col, index) => (e) => {
    e.preventDefault();
    setDragOver(`${col}:${index}`);
  };
  const onCardDrop = (col, index) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragging) applyMove(dragging.id, col, index);
    setDragging(null); setDragOver(null);
  };
  const onColumnDragOver = (col) => (e) => { e.preventDefault(); setDragOver(col); };
  const onColumnDrop = (col) => (e) => {
    e.preventDefault();
    if (dragging) applyMove(dragging.id, col, null);
    setDragging(null); setDragOver(null);
  };

  const moveWithin = (col, id, delta) => {
    const arr = [...staging[col]];
    const i = arr.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= arr.length) return;
    pushHistory();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setStaging({ ...staging, [col]: arr });
    setIsDirty(true);
  };

  const quickMove = (id, currentCol, targetKey) => applyMove(id, targetKey === currentCol ? null : targetKey, null);

  const toggleCompare = (id) => setCompareIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev);

  // --- persistence ---
  const refreshNow = () => {
    setStaging(seedStaging(applications));
    setIsDirty(false);
    setStaleWhileEditing(false);
    setHistory([]);
  };

  const proposeShortlist = async () => {
    setError(''); setProposing(true);
    const ids = staging.shortlist;
    const applicationRankVersions = Object.fromEntries(ids.map((id) => [id, byId[id]?.rankVersion ?? 0]));
    try {
      await staffClient.post(`/api/vacancies/${vacancy.id}/rank`, { applicationIds: ids, applicationRankVersions });
      setIsDirty(false);
      setStaleWhileEditing(false);
      setHistory([]);
      onUpdated();
    } catch (err) {
      if (err.response?.status === 409) {
        setError('This ranking changed elsewhere since you loaded it - refreshing the current state now.');
        setIsDirty(false);
        setStaleWhileEditing(false);
        onUpdated();
      } else {
        setError(err.response?.data?.error || 'Could not propose this shortlist');
      }
    } finally {
      setProposing(false);
    }
  };

  const approveShortlist = async () => {
    setError(''); setApproving(true);
    try {
      await staffClient.post(`/api/applications/vacancies/${vacancy.id}/approve-shortlist`);
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve shortlist');
    } finally {
      setApproving(false);
    }
  };

  const quickMoveTargetsFor = (currentCol) => {
    const all = [{ key: 'pool', label: 'Back to pool' }, { key: 'shortlist', label: 'Shortlist' }];
    return all.filter((t) => t.key !== currentCol);
  };

  const compareApps = compareIds.map((id) => byId[id]).filter(Boolean);

  return (
    <div>
      {staleWhileEditing && (
        <Card accent="var(--color-primary)" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>This vacancy changed elsewhere while you were arranging the shortlist - your unsaved layout is kept exactly as-is.</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="ghost" onClick={() => setStaleWhileEditing(false)} style={{ padding: '4px 10px', fontSize: 13 }}>Keep editing</Button>
              <Button variant="secondary" onClick={refreshNow} style={{ padding: '4px 10px', fontSize: 13 }}>Refresh now</Button>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card accent="var(--color-danger)" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}><X size={14} /></button>
          </div>
        </Card>
      )}

      {hasProposedAwaitingApproval && canApprove && (
        <Card accent="var(--color-warning)" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>
              <Sparkles size={14} style={{ verticalAlign: -2, marginRight: 4, color: 'var(--color-warning)' }} />
              A proposed interview shortlist is awaiting your approval before candidates are notified and interviews can be scheduled.
            </span>
            <Button onClick={approveShortlist} disabled={approving}>{approving ? 'Approving...' : 'Approve shortlist'}</Button>
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--color-text-muted)' }} />
          <TextField placeholder="Search candidates on this board" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 30 }} />
        </div>
        <Button
          variant={compareMode ? 'primary' : 'ghost'}
          onClick={() => { setCompareMode((v) => !v); setCompareIds([]); }}
          style={{ padding: '6px 12px', fontSize: 13 }}
        >
          <Scale size={14} /> {compareMode ? 'Exit compare' : 'Compare'}
        </Button>
        {history.length > 0 && (
          <Button variant="ghost" onClick={undo} style={{ padding: '6px 12px', fontSize: 13 }}>Undo last move</Button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canRank && staging.shortlist.length > 0 && (
            <Button onClick={proposeShortlist} disabled={proposing}>
              {proposing ? 'Proposing...' : `Propose interview shortlist (${staging.shortlist.length})`}
            </Button>
          )}
        </div>
      </div>

      {compareMode && compareApps.length > 0 && (
        <div style={{
          position: 'sticky', top: 8, zIndex: 5, marginBottom: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4
        }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{compareApps.length} selected (up to 3)</span>
          <Button onClick={() => setCompareIds([])} variant="ghost" style={{ marginLeft: 4 }}>Clear</Button>
          {compareApps.length >= 2 && (
            <Button onClick={() => setDetailApp('__compare__')} style={{ marginLeft: 4 }}>
              Compare {compareApps.length} <ArrowRight size={14} />
            </Button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
        <ColumnShell
          title="Applicant pool" count={poolApps.length} accent="var(--color-text-muted)"
          onDragOver={onColumnDragOver('pool')} onDrop={onColumnDrop('pool')} isOver={dragOver === 'pool'}
          headerExtra={<Users size={14} color="var(--color-text-muted)" />}
        >
          {poolApps.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px' }}>Nothing waiting to be ranked.</p>}
          {poolApps.map((a) => (
            <PipelineCard
              key={a.id} app={a} draggable={canRank}
              onDragStart={onCardDragStart(a.id, 'pool')} onDragEnd={onCardDragEnd}
              onDragOver={(e) => { e.stopPropagation(); onCardDragOver('pool', poolApps.indexOf(a))(e); }}
              onDrop={(e) => onCardDrop('pool', poolApps.indexOf(a))(e)}
              isDragging={dragging?.id === a.id} isOver={dragOver === `pool:${poolApps.indexOf(a)}`}
              onOpen={setDetailApp}
              onQuickMove={(key) => quickMove(a.id, 'pool', key)}
              quickMoveTargets={a.status === 'Submitted' ? [] : [{ key: 'shortlist', label: 'Shortlist for interview' }]}
              compareMode={compareMode} compareSelected={compareIds.includes(a.id)} onToggleCompare={toggleCompare}
            />
          ))}
        </ColumnShell>

        <ColumnShell
          title="Interview shortlist" count={`${shortlistApps.length}`} accent="var(--color-accent)"
          onDragOver={onColumnDragOver('shortlist')} onDrop={onColumnDrop('shortlist')} isOver={dragOver === 'shortlist'}
          headerExtra={<ProgressRing percent={Math.min(100, Math.round((staging.shortlist.length / Math.max(suggestedSize, 1)) * 100))} size={26} strokeWidth={4} color="var(--color-accent)" />}
        >
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '0 4px', margin: '0 0 8px' }}>
            {vacancy.positionsRequired} position{vacancy.positionsRequired === 1 ? '' : 's'} - around {suggestedSize} interviews leaves room for reserves.
            Order is the interview order; who gets the job is decided on the merit list.
          </p>
          {shortlistApps.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px' }}>Drag candidates here to invite them to interview.</p>}
          {shortlistApps.map((a, i) => (
            <PipelineCard
              key={a.id} app={a} draggable={canRank}
              onDragStart={onCardDragStart(a.id, 'shortlist')} onDragEnd={onCardDragEnd}
              onDragOver={(e) => { e.stopPropagation(); onCardDragOver('shortlist', i)(e); }}
              onDrop={(e) => onCardDrop('shortlist', i)(e)}
              isDragging={dragging?.id === a.id} isOver={dragOver === `shortlist:${i}`}
              onOpen={setDetailApp} onMoveUp={() => moveWithin('shortlist', a.id, -1)} onMoveDown={() => moveWithin('shortlist', a.id, 1)}
              onQuickMove={(key) => quickMove(a.id, 'shortlist', key)} quickMoveTargets={quickMoveTargetsFor('shortlist')}
              compareMode={compareMode} compareSelected={compareIds.includes(a.id)} onToggleCompare={toggleCompare}
            />
          ))}
        </ColumnShell>

        <ColumnShell
          title="Interviewing" count={interviewingApps.length} accent="var(--color-primary)"
          headerExtra={onGoToStage && interviewingApps.length > 0 && (
            <button type="button" onClick={() => onGoToStage('interviews')}
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
              Manage <ArrowRight size={11} style={{ verticalAlign: -1 }} />
            </button>
          )}
        >
          {interviewingApps.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px' }}>Nobody is waiting on an interview.</p>}
          {interviewingApps.map((a) => (
            <PipelineCard
              key={a.id} app={a} draggable={false} onOpen={setDetailApp}
              compareMode={compareMode} compareSelected={compareIds.includes(a.id)} onToggleCompare={toggleCompare}
              quickMoveTargets={[]}
            />
          ))}
        </ColumnShell>

        <ColumnShell
          title="Interviewed" count={interviewedApps.length} accent="var(--color-accent)"
          headerExtra={onGoToStage && interviewedApps.length > 0 && (
            <button type="button" onClick={() => onGoToStage('merit')}
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
              Merit list <ArrowRight size={11} style={{ verticalAlign: -1 }} />
            </button>
          )}
        >
          {interviewedApps.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px' }}>No interview verdicts yet.</p>}
          {interviewedApps.map((a) => (
            <PipelineCard
              key={a.id} app={a} draggable={false} onOpen={setDetailApp}
              compareMode={compareMode} compareSelected={compareIds.includes(a.id)} onToggleCompare={toggleCompare}
              quickMoveTargets={[]}
            />
          ))}
        </ColumnShell>

        <ColumnShell
          title="Decided" count={decidedApps.length} accent="var(--color-text-muted)" muted
          headerExtra={
            <button onClick={() => setDecidedOpen((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <ChevronDown size={16} style={{ transform: decidedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
            </button>
          }
        >
          {decidedOpen ? (
            decidedApps.length === 0 ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px' }}>Nothing decided yet.</p> :
            decidedApps.map((a) => (
              <PipelineCard
                key={a.id} app={a} draggable={false} onOpen={setDetailApp}
                compareMode={compareMode} compareSelected={compareIds.includes(a.id)} onToggleCompare={toggleCompare}
                quickMoveTargets={[]}
              />
            ))
          ) : (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px', cursor: 'pointer' }} onClick={() => setDecidedOpen(true)}>
              {decidedApps.length} application(s) collapsed - click to expand.
            </p>
          )}
        </ColumnShell>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 1100,
          background: 'var(--color-text)', color: '#fff', borderRadius: 'var(--radius-sm)',
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: 13, maxWidth: 360
        }}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button onClick={toast.undo} style={{ background: 'none', border: 'none', color: 'var(--color-primary-light)', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              Undo
            </button>
          )}
        </div>
      )}

      {detailApp === '__compare__' && (
        <CompareDrawer apps={compareApps} onClose={() => setDetailApp(null)} />
      )}
      {detailApp && detailApp !== '__compare__' && (
        <Modal title={detailApp.candidate.fullName} onClose={() => setDetailApp(null)} maxWidth={720}>
          <ApplicationReviewCard
            app={byId[detailApp.id] || detailApp} vacancy={vacancy} staffRole={staffRole}
            onUpdated={() => { onUpdated(); setDetailApp(null); }}
            onDownloadCv={onDownloadCv} downloadingId={downloadingId}
          />
        </Modal>
      )}
    </div>
  );
}
