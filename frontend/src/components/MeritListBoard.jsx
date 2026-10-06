import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GripVertical, ChevronUp, ChevronDown, X, Plus, RotateCcw, Trophy, Lock, CheckCircle2, Clock,
  CalendarClock, Award, FileText
} from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Card from './Card';
import Button from './Button';
import Alert from './Alert';
import Avatar from './Avatar';
import StatusBadge from './StatusBadge';
import LoadingState from './LoadingState';
import InterviewRoundPanel from './interviews/InterviewRoundPanel';
import OfferComposer from './offers/OfferComposer';
import OfferSummary from './offers/OfferSummary';
import CsvDownloadButton from './CsvDownloadButton';
import OfferActions from './offers/OfferActions';
import { hintText } from './interviews/formStyles';
import { errorMessage } from '../utils/interviews';
import { fileLink } from '../utils/fileLink';

// ===========================================================================
// Step three of selection: the post-interview merit list (backend
// meritListService). Interviewed candidates are ranked on their results;
// the first positionsRequired candidates the panel recommended outright
// ("Shortlist") are Primary - offers are recommended for them - and the rest
// wait in Reserve, moved up in merit order when a Primary declines.
//
// The ranking is staged locally (drag, arrows, add/remove) and only saved
// by "Propose merit list"; a Principal HR Officer+ who didn't propose it
// then approves it. Once an offer is in play the list is locked.
// ===========================================================================

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

// Mirrors meritListService.assignListStatus: Primary for the first
// positionsRequired "Shortlist" candidates; a "Hold" is never Primary and
// must not sit above a "Shortlist".
function computeListStatus(rows, positionsRequired) {
  let seenHold = false;
  let holdAboveShortlist = null;
  const statuses = rows.map((r, i) => {
    if (r.recommendation === 'Hold') seenHold = true;
    else if (seenHold && !holdAboveShortlist) holdAboveShortlist = r;
    return i < positionsRequired && r.recommendation === 'Shortlist' ? 'Primary' : 'Reserve';
  });
  return { statuses, holdAboveShortlist };
}

// The order to start from: the saved list, or the interview results when
// there is none. While the list can still be edited, candidates who already
// had an offer (declined or withdrawn - an offer still in play locks the
// list) are left out; re-proposing takes them off it.
function seedFrom(board) {
  if (board.state === 'NotStarted') return board.suggestedOrder;
  return board.entries.filter((e) => board.locked || e.status === 'Interviewed').map((e) => e.applicationId);
}

function ScoreBar({ score }) {
  if (score == null) return <span style={hintText}>No score</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--color-bg-subtle)', borderRadius: 999 }}>
        <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', borderRadius: 999, background: 'var(--color-primary)' }} />
      </div>
      <strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{Math.round(score * 10) / 10}</strong>
    </div>
  );
}

function RankBadge({ rank, primary }) {
  return (
    <span style={{
      width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums',
      background: primary ? 'var(--color-accent)' : 'var(--color-bg-subtle)',
      color: primary ? '#fff' : 'var(--color-text)',
      border: primary ? 'none' : '1px solid var(--color-border)'
    }}>
      {rank}
    </span>
  );
}

const iconButton = {
  background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer',
  padding: '2px 4px', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center'
};

function StateBanner({ board }) {
  const fmt = (at) => (at ? new Date(at).toLocaleDateString() : '');
  if (board.state === 'NotStarted') {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Clock size={14} /> Not proposed yet</span>;
  }
  if (board.state === 'Proposed') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-warning)' }}>
        <Clock size={14} /> Awaiting approval{board.proposedBy ? ` - proposed by ${board.proposedBy.name} on ${fmt(board.proposedBy.at)}` : ''}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-accent)' }}>
      <CheckCircle2 size={14} /> Approved{board.approvedBy ? ` by ${board.approvedBy.name} on ${fmt(board.approvedBy.at)}` : ''}
    </span>
  );
}

// vacancy: needs id and positionsRequired. reloadKey: bump to refetch (the
// parent does on live dashboard events). onChanged: tell the parent
// something here changed (a proposal, approval or offer recommendation).
export default function MeritListBoard({ vacancy, staffRole, reloadKey, onChanged }) {
  const rank = ROLE_RANK[staffRole] || 0;
  const canRank = rank >= ROLE_RANK.Senior_HR_Officer;
  const canApprove = rank >= ROLE_RANK.Principal_HR_Officer;

  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [staging, setStaging] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [openRoundId, setOpenRoundId] = useState(null);
  // Application whose offer is being drafted (OfferComposer).
  const [composeFor, setComposeFor] = useState(null);

  const load = useCallback(() => {
    staffClient.get(`/api/applications/vacancies/${vacancy.id}/merit-list`)
      .then((res) => setBoard(res.data))
      .catch((err) => setError(errorMessage(err, 'Could not load the merit list')));
  }, [vacancy.id]);
  useEffect(() => { load(); }, [load, reloadKey]);

  // Re-seed the staged order from the server unless there are unsaved moves.
  useEffect(() => {
    if (!board || dirty) return;
    setStaging(seedFrom(board));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const byId = useMemo(() => {
    if (!board) return {};
    return Object.fromEntries([...board.entries, ...board.eligible].map((r) => [r.applicationId, r]));
  }, [board]);

  if (!board) {
    return error ? <Alert type="error" message={error} /> : <LoadingState />;
  }

  const editable = canRank && !board.locked;
  const rows = staging.map((id) => byId[id]).filter(Boolean);
  const { statuses: computed, holdAboveShortlist } = computeListStatus(rows, vacancy.positionsRequired);
  // Before anything is changed, show what the server holds - a declined
  // offer's promotion moves a Reserve to Primary without re-ranking.
  const statusOf = (row, i) => (!dirty && board.state !== 'NotStarted' && row.meritListStatus ? row.meritListStatus : computed[i]);
  const primaryCount = rows.filter((r, i) => statusOf(r, i) === 'Primary').length;
  const lastPrimaryIndex = rows.reduce((last, r, i) => (statusOf(r, i) === 'Primary' ? i : last), -1);
  const unranked = board.eligible.filter((r) => !staging.includes(r.applicationId))
    .concat(board.entries.filter((r) => r.status === 'Interviewed' && !staging.includes(r.applicationId)));
  const shortlistVerdicts = rows.filter((r) => r.recommendation === 'Shortlist').length;
  const offerCounts = board.entries.reduce((acc, e) => {
    if (!e.offer) return acc;
    acc.total += 1;
    if (['Declined', 'Expired', 'Withdrawn'].includes(e.offer.status)) acc.closed += 1;
    else acc[e.offer.status] = (acc[e.offer.status] || 0) + 1;
    return acc;
  }, { total: 0, closed: 0 });

  const stage = (next) => { setStaging(next); setDirty(true); setMessage(''); };
  const move = (from, to) => {
    if (to < 0 || to >= staging.length || from === to) return;
    const next = [...staging];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    stage(next);
  };
  const remove = (id) => stage(staging.filter((x) => x !== id));
  const add = (id) => {
    // A "Shortlist" goes after the last "Shortlist"; a "Hold" at the end -
    // so adding someone never breaks the Hold-below-Shortlist rule.
    const row = byId[id];
    const next = [...staging];
    if (row.recommendation === 'Shortlist') {
      let at = 0;
      next.forEach((x, i) => { if (byId[x]?.recommendation === 'Shortlist') at = i + 1; });
      next.splice(at, 0, id);
    } else next.push(id);
    stage(next);
  };
  const resetToResults = () => stage([...board.suggestedOrder]);
  const discard = () => { setDirty(false); setStaging(seedFrom(board)); };

  const run = async (key, fn, success) => {
    setBusy(key); setError(''); setMessage('');
    try {
      await fn();
      if (success) setMessage(success);
      setDirty(false);
      load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
      if (err.response?.status === 409) { setDirty(false); load(); }
    } finally {
      setBusy('');
    }
  };

  const propose = () => run('propose', () => {
    const applicationRankVersions = Object.fromEntries([...board.entries, ...board.eligible].map((r) => [r.applicationId, r.rankVersion]));
    return staffClient.post(`/api/applications/vacancies/${vacancy.id}/merit-list`, { applicationIds: staging, applicationRankVersions });
  }, 'Merit list proposed. A Principal HR Officer who did not propose it now needs to approve it.');
  // The list on screen is what is approved - re-proposed since, the API
  // refuses (MERIT_LIST_CHANGED) and the board reloads.
  const approve = () => run('approve', () => {
    const applicationRankVersions = Object.fromEntries(board.entries
      .filter((r) => r.meritStatus === 'Proposed').map((r) => [r.applicationId, r.rankVersion]));
    return staffClient.post(`/api/applications/vacancies/${vacancy.id}/merit-list/approve`, { applicationRankVersions });
  }, 'Merit list approved. Offers can now be recommended for the Primary candidates.');
  const afterOfferChange = () => { load(); onChanged?.(); };

  const onDrop = (index) => (e) => {
    e.preventDefault();
    if (dragging != null) move(staging.indexOf(dragging), index);
    setDragging(null); setDragOver(null);
  };

  return (
    <div>
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />

      <Card accent={board.state === 'Approved' ? 'var(--color-accent)' : board.state === 'Proposed' ? 'var(--color-warning)' : 'var(--color-primary)'}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trophy size={18} color="var(--color-primary)" />
              <strong style={{ fontSize: 16 }}>Merit list</strong>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}><StateBanner board={board} /></div>
            <div style={{ ...hintText, marginTop: 4 }}>
              {vacancy.positionsRequired} position{vacancy.positionsRequired === 1 ? '' : 's'} · {primaryCount} Primary · {rows.length - primaryCount} Reserve
              {board.awaiting.length > 0 && ` · ${board.awaiting.length} still in interviews`}
              {offerCounts.total > 0 && ` · offers: ${[
                offerCounts.Accepted && `${offerCounts.Accepted} accepted`,
                offerCounts.Approved && `${offerCounts.Approved} with candidate`,
                (offerCounts.Recommended || offerCounts.Returned) && `${(offerCounts.Recommended || 0) + (offerCounts.Returned || 0)} awaiting approval`,
                offerCounts.closed && `${offerCounts.closed} declined/expired/withdrawn`
              ].filter(Boolean).join(', ')}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rows.length > 0 && !dirty && (
              <CsvDownloadButton url={`/api/applications/vacancies/${vacancy.id}/merit-list/export`} label="Export CSV" fallbackName="merit-list.csv" />
            )}
            {editable && (
              <>
                <Button variant="ghost" onClick={resetToResults} disabled={!!busy} style={{ padding: '6px 12px', fontSize: 13 }}>
                  <RotateCcw size={14} /> Order by interview results
                </Button>
                {dirty && <Button variant="ghost" onClick={discard} disabled={!!busy} style={{ padding: '6px 12px', fontSize: 13 }}>Discard changes</Button>}
                {(dirty || board.state === 'NotStarted') && (
                  <Button onClick={propose} loading={busy === 'propose'} loadingText="Proposing..."
                    disabled={!!busy || rows.length === 0 || !!holdAboveShortlist}>
                    Propose merit list ({rows.length})
                  </Button>
                )}
              </>
            )}
            {board.state === 'Proposed' && !dirty && canApprove && (
              <Button onClick={approve} loading={busy === 'approve'} loadingText="Approving..." disabled={!!busy}>
                <CheckCircle2 size={14} /> Approve merit list
              </Button>
            )}
          </div>
        </div>
        {board.locked && (
          <div style={{ ...hintText, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={12} /> Offers have been made from this list, so it can no longer be re-ranked. A declined offer moves the next reserve up automatically.
          </div>
        )}
      </Card>

      {holdAboveShortlist && (
        <Alert type="error" message={`${holdAboveShortlist.candidateName} was recommended by the panel but is ranked below a candidate put on "Hold". Move them up - a "Hold" can only be a reserve.`} />
      )}
      {editable && shortlistVerdicts < vacancy.positionsRequired && rows.length > 0 && (
        <Alert type="info" message={`Only ${shortlistVerdicts} candidate${shortlistVerdicts === 1 ? ' was' : 's were'} recommended outright for ${vacancy.positionsRequired} position${vacancy.positionsRequired === 1 ? '' : 's'}. "Hold" candidates can only be reserves, so some positions will stay open.`} />
      )}

      <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 440px', minWidth: 0 }}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {rows.length === 0 && (
              <p style={{ margin: 0, padding: 16, color: 'var(--color-text-muted)' }}>
                {board.eligible.length === 0
                  ? 'Nobody has interview results yet. Candidates appear here once their results are recorded with a "Shortlist" or "Hold" verdict.'
                  : 'Add interviewed candidates from the right to build the list.'}
              </p>
            )}
            {rows.map((row, i) => {
              const status = statusOf(row, i);
              const primary = status === 'Primary';
              const movable = editable && row.status === 'Interviewed';
              const canRecommend = canApprove && !dirty && board.state === 'Approved' && primary && row.status === 'Interviewed' && !row.offerStatus;
              return (
                <React.Fragment key={row.applicationId}>
                  <div
                    draggable={movable}
                    onDragStart={movable ? () => setDragging(row.applicationId) : undefined}
                    onDragEnd={() => { setDragging(null); setDragOver(null); }}
                    onDragOver={movable ? (e) => { e.preventDefault(); setDragOver(i); } : undefined}
                    onDrop={movable ? onDrop(i) : undefined}
                    style={{
                      display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                      padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                      background: dragOver === i ? 'var(--color-primary-light)' : primary ? 'var(--color-bg)' : 'var(--color-bg-subtle)',
                      opacity: dragging === row.applicationId ? 0.4 : 1
                    }}
                  >
                    <span style={{ color: 'var(--color-text-muted)', cursor: movable ? 'grab' : 'default', visibility: movable ? 'visible' : 'hidden' }}>
                      <GripVertical size={14} />
                    </span>
                    <RankBadge rank={i + 1} primary={primary} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Avatar name={row.candidateName} size={24} />
                        <button type="button" onClick={() => row.roundId && setOpenRoundId(row.roundId)}
                          style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, fontSize: 14, cursor: row.roundId ? 'pointer' : 'default', color: 'var(--color-text)', fontFamily: 'inherit' }}>
                          {row.candidateName}
                        </button>
                        <span style={hintText}>{row.candidateType}</span>
                        <StatusBadge status={status} />
                        {row.recommendation && <StatusBadge status={row.recommendation} />}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                        <ScoreBar score={row.interviewScore} />
                        {row.scoreSheetUrl && (
                          <a href={fileLink(row.scoreSheetUrl)} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }} title={row.scoreSheetName || 'Signed score sheet'}>
                            <FileText size={12} /> Signed score sheet
                          </a>
                        )}
                      </div>
                      {/* The offer follows straight on from the list: its
                          status, deadline and terms, and what can be done next. */}
                      {row.offer && (
                        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                          <OfferSummary offer={row.offer} compact />
                          <OfferActions offer={row.offer} applicationId={row.applicationId} staffRole={staffRole} onChanged={afterOfferChange} />
                        </div>
                      )}
                      {!row.offer && primary && board.state === 'Approved' && !dirty && row.status === 'Interviewed' && !canRecommend && (
                        <div style={{ ...hintText, marginTop: 6 }}>Ready for an offer - a Principal HR Officer drafts it.</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {canRecommend && (
                        <Button style={{ padding: '4px 10px', fontSize: 12 }} disabled={!!busy}
                          onClick={() => setComposeFor(row.applicationId)}>
                          <Award size={13} /> Draft offer
                        </Button>
                      )}
                      {movable && (
                        <>
                          <button type="button" style={iconButton} aria-label="Move up" onClick={() => move(i, i - 1)}><ChevronUp size={13} /></button>
                          <button type="button" style={iconButton} aria-label="Move down" onClick={() => move(i, i + 1)}><ChevronDown size={13} /></button>
                          <button type="button" style={iconButton} aria-label="Take off the list" onClick={() => remove(row.applicationId)}><X size={13} /></button>
                        </>
                      )}
                    </div>
                  </div>
                  {i === lastPrimaryIndex && i < rows.length - 1 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', fontSize: 11, fontWeight: 700,
                      color: 'var(--color-accent)', background: 'var(--color-bg)', letterSpacing: 0.3, textTransform: 'uppercase'
                    }}>
                      <span style={{ flex: 1, borderTop: '2px dashed var(--color-accent)' }} />
                      Appointment line - reserves below
                      <span style={{ flex: 1, borderTop: '2px dashed var(--color-accent)' }} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </Card>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <Card>
            <strong style={{ fontSize: 14 }}>Interviewed, not on the list</strong>
            <div style={{ ...hintText, marginBottom: 8 }}>Candidates with a "Shortlist" or "Hold" verdict.</div>
            {unranked.length === 0 && <p style={{ ...hintText, margin: 0 }}>Everyone eligible is on the list.</p>}
            {unranked.map((row) => (
              <div key={row.applicationId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{row.candidateName}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                    <StatusBadge status={row.recommendation} />
                    <span style={hintText}>{row.interviewScore != null ? `score ${row.interviewScore}` : ''}</span>
                  </div>
                </div>
                {editable && (
                  <Button variant="ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => add(row.applicationId)}>
                    <Plus size={12} /> Add
                  </Button>
                )}
              </div>
            ))}
          </Card>

          <Card>
            <strong style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}><CalendarClock size={14} /> Still in interviews</strong>
            <div style={{ ...hintText, marginBottom: 8 }}>They join the pool above once their results are recorded.</div>
            {board.awaiting.length === 0 && <p style={{ ...hintText, margin: 0 }}>Nobody - every interview has a verdict.</p>}
            {board.awaiting.map((row) => (
              <div key={row.applicationId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: 13 }}>{row.candidateName}</span>
                {row.roundId ? (
                  <button type="button" onClick={() => setOpenRoundId(row.roundId)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                    Open
                  </button>
                ) : <StatusBadge status={row.status} />}
              </div>
            ))}
          </Card>
        </div>
      </div>

      {openRoundId && (
        <InterviewRoundPanel roundId={openRoundId} onClose={() => setOpenRoundId(null)} onChanged={() => { load(); onChanged?.(); }} />
      )}
      {composeFor && (
        <OfferComposer applicationId={composeFor} onClose={() => setComposeFor(null)}
          onSaved={() => { setMessage('Offer sent for approval. A Manager or Director approves it before the candidate is told.'); afterOfferChange(); }} />
      )}
    </div>
  );
}
