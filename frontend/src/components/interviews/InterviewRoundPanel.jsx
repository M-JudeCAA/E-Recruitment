import React, { useCallback, useEffect, useState } from 'react';
import {
  Crown, Link2, Mail, CalendarClock, MapPin, Video, Phone, Download, AlertTriangle, UserMinus, Trash2, PenLine, Users
} from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import { useAuth } from '../../models/AuthContext';
import Modal from '../Modal';
import Button from '../Button';
import Alert from '../Alert';
import Select from '../Select';
import TextField from '../TextField';
import TextArea from '../TextArea';
import StatusBadge from '../StatusBadge';
import Spinner from '../Spinner';
import ScoreForm, { validateScore } from './ScoreForm';
import RubricEditor from './RubricEditor';
import {
  MODES, formatDateTime, timeRange, formatDay, venueLabel, toLocalInput, fromLocalInput,
  saveCalendarFile, CONFLICT_LABELS, errorMessage, HIGH_SPREAD
} from '../../utils/interviews';
import { inputStyle, sectionLabel, hintText, chipStyle, ROUND_LABELS } from './formStyles';

// Matches backend/src/middleware/auth.js's ROLE_RANK - changing an interview
// is Senior HR Officer+, reading it is any HR tier.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

const ModeIcon = ({ mode, size = 15 }) => (mode === 'Virtual' ? <Video size={size} /> : mode === 'Phone' ? <Phone size={size} /> : <MapPin size={size} />);

function ProgressBar({ scored, total }) {
  const pct = total ? Math.round((scored / total) * 100) : 0;
  return (
    <div aria-label={`${scored} of ${total} panel scores in`} style={{ height: 8, borderRadius: 999, background: 'var(--color-bg-subtle)', overflow: 'hidden', flex: 1, minWidth: 80 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--color-accent)' : 'var(--color-primary)' }} />
    </div>
  );
}

function ConflictList({ conflicts }) {
  return (
    <div style={{ background: '#fbeceb', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 12 }}>
      {conflicts.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, fontSize: 13, color: 'var(--color-danger)', marginBottom: 2 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> <span><strong>{CONFLICT_LABELS[c.type]}:</strong> {c.message}</span>
        </div>
      ))}
    </div>
  );
}

// One interview round, end to end. Opened from the Interview Hub, the review
// card, or a ?round= link. onChanged lets the opener refresh its own list.
export default function InterviewRoundPanel({ roundId, onClose, onChanged }) {
  const { staff } = useAuth();
  const canEdit = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;

  const [round, setRound] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState('panel');
  // Sub-views that replace the main content: score | reschedule | cancel | noShow | finalize | recuse | addPanelist
  const [view, setView] = useState(null);
  const [target, setTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await staffClient.get(`/api/interviews/${roundId}`);
      setRound(res.data);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load this interview'));
    }
  }, [roundId]);
  useEffect(() => { load(); }, [load]);

  const afterChange = async (message) => {
    setNotice(message || '');
    setError('');
    setView(null);
    setTarget(null);
    await load();
    onChanged?.();
  };

  const act = async (key, fn, message) => {
    setBusy(key);
    setError('');
    try {
      const result = await fn();
      await afterChange(typeof message === 'function' ? message(result) : message);
      return result;
    } catch (err) {
      setError(errorMessage(err, 'That did not work - please try again'));
      return null;
    } finally {
      setBusy(null);
    }
  };

  // --- form state for the sub-views ---
  const [ratings, setRatings] = useState({});
  const [scoreValue, setScoreValue] = useState('');
  const [comments, setComments] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [reason, setReason] = useState('');
  const [notifyPanel, setNotifyPanel] = useState(true);
  const [conflicts, setConflicts] = useState(null);
  const [recommendation, setRecommendation] = useState('Shortlist');
  const [notes, setNotes] = useState('');
  const [newPanelist, setNewPanelist] = useState({ name: '', trade: '', email: '', isChair: false });
  const [details, setDetails] = useState(null);
  const [linkResults, setLinkResults] = useState(null);

  const open = (v, t = null) => {
    setError(''); setNotice(''); setConflicts(null); setReason(''); setNotes(''); setTarget(t); setView(v);
    if (v === 'score') {
      setRatings(t?.criterionScores || {}); setScoreValue(t?.score ?? ''); setComments(t?.comments || '');
    }
    if (v === 'reschedule') {
      setNewDate(toLocalInput(round.scheduledDate)); setNewDuration(round.durationMinutes || 60); setNotifyPanel(true);
    }
    if (v === 'finalize') setRecommendation(round.score != null && round.score >= 60 ? 'Shortlist' : 'Hold');
    if (v === 'addPanelist') setNewPanelist({ name: '', trade: '', email: '', isChair: false });
  };

  useEffect(() => {
    if (round && tab === 'details') {
      setDetails({
        durationMinutes: round.durationMinutes || 60, mode: round.mode || 'In-person', location: round.location || '',
        meetingLink: round.meetingLink || '', instructions: round.instructions || '', internalNotes: round.internalNotes || '',
        criteria: round.criteria || [], notifyParticipants: true
      });
    }
  }, [round, tab]);

  if (loadError) {
    return <Modal title="Interview" onClose={onClose}><Alert type="error" message={loadError} /></Modal>;
  }
  if (!round) {
    return <Modal title="Interview" onClose={onClose}><div style={{ padding: 24, textAlign: 'center' }}><Spinner size={20} /></div></Modal>;
  }

  const app = round.application;
  const scheduled = round.status === 'Scheduled';
  const started = round.scheduledDate && new Date(round.scheduledDate) <= new Date();
  const anyScored = round.panelMembers.some((m) => m.score != null);
  const { progress } = round;

  const downloadIcs = async () => {
    try {
      const res = await staffClient.get(`/api/interviews/${round.id}/calendar.ics`, { responseType: 'text' });
      saveCalendarFile(res.data, `interview-${round.id}.ics`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the calendar file'));
    }
  };

  const submitScore = () => {
    const problem = validateScore(round.criteria, ratings, scoreValue);
    if (problem) { setError(problem); return; }
    act('score', () => staffClient.patch(`/api/interviews/panel-members/${target.id}/score`, round.criteria
      ? { criterionScores: ratings, comments }
      : { score: Number(scoreValue), comments }), `Score recorded for ${target.name}.`);
  };

  const submitReschedule = async (force = false) => {
    if (!newDate) { setError('Choose the new date and time'); return; }
    setBusy('reschedule'); setError('');
    try {
      await staffClient.patch(`/api/interviews/${round.id}/reschedule`, {
        scheduledDate: fromLocalInput(newDate), durationMinutes: Number(newDuration), reason, notifyPanel, allowConflicts: force
      });
      await afterChange('Rescheduled. The candidate has been told and asked to confirm the new time.');
    } catch (err) {
      if (err.response?.data?.code === 'SCHEDULE_CONFLICT') setConflicts(err.response.data.conflicts);
      setError(errorMessage(err, 'Could not reschedule'));
    } finally {
      setBusy(null);
    }
  };

  const sendLinks = () => act('links', async () => {
    const res = await staffClient.post(`/api/interviews/${round.id}/access-links`);
    setLinkResults(res.data.results);
    return res.data.results;
  }, (results) => `Scoring links sent to ${results.filter((r) => r.emailed).length} panelist(s) by email.`
    + (results.some((r) => !r.emailed) ? ' Share the links below with the others.' : ''));

  const sendOneLink = (m) => act(`link-${m.id}`, async () => {
    const res = await staffClient.post(`/api/interviews/panel-members/${m.id}/access-link`);
    setLinkResults(res.data.emailed ? null : [{ panelMemberId: m.id, name: m.name, emailed: false, url: res.data.url }]);
    return res.data;
  }, (data) => (data.emailed ? `Scoring link emailed to ${m.name}. Any earlier link for them no longer works.` : `${m.name} has no email - share the link below.`));

  const saveDetails = () => act('details', () => staffClient.patch(`/api/interviews/${round.id}`, {
    durationMinutes: Number(details.durationMinutes), mode: details.mode,
    location: details.mode === 'In-person' ? details.location : null,
    meetingLink: details.mode === 'Virtual' ? details.meetingLink : null,
    instructions: details.instructions, internalNotes: details.internalNotes,
    ...(anyScored ? {} : { criteria: details.criteria.filter((c) => c.name.trim()).map((c) => ({ id: c.id, name: c.name.trim(), weight: Number(c.weight) || 1, description: c.description || undefined })) }),
    notifyParticipants: details.notifyParticipants
  }), 'Details saved.');

  // ---------------------------------------------------------------- header
  const header = (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge status={round.status} label={ROUND_LABELS[round.status]} />
        {scheduled && !started && <StatusBadge status={round.candidateResponse} label={`Candidate: ${ROUND_LABELS[round.candidateResponse]}`} />}
        {round.recommendation && <StatusBadge status={round.recommendation} label={`Panel: ${round.recommendation}`} />}
        {round.rescheduleCount > 0 && <span style={hintText}>Changed {round.rescheduleCount}×</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 10, fontSize: 14 }}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <CalendarClock size={15} style={{ flexShrink: 0 }} /> {round.scheduledDate ? <span>{formatDay(round.scheduledDate)}<br />{timeRange(round)}</span> : 'Date to be confirmed'}
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          <ModeIcon mode={round.mode} />
          {round.mode === 'Virtual' && round.meetingLink
            ? <a href={round.meetingLink} target="_blank" rel="noreferrer" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{round.meetingLink}</a>
            : venueLabel(round)}
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Users size={15} /> {progress.total} panelist{progress.total === 1 ? '' : 's'}{round.scheduledBy ? ` · booked by ${round.scheduledBy.name}` : ''}
        </span>
      </div>
      {round.candidateResponse === 'RescheduleRequested' && round.candidateResponseNote && (
        <Alert type="warning" message={`The candidate asked to move this interview: "${round.candidateResponseNote}"`} />
      )}
      {round.status === 'Cancelled' && <Alert type="info" message={`Cancelled${round.cancelledBy ? ` by ${round.cancelledBy.name}` : ''}: ${round.cancellationReason || ''}`} />}
      {round.otherRounds?.length > 0 && (
        <div style={{ ...hintText, marginTop: 6 }}>
          Other rounds: {round.otherRounds.map((r) => `Round ${r.roundNumber} (${ROUND_LABELS[r.status] || r.status}${r.recommendation ? `, ${r.recommendation}` : ''}${r.score != null ? `, ${r.score}` : ''})`).join(' · ')}
        </div>
      )}
    </div>
  );

  // ------------------------------------------------------------- sub-views
  let body;
  let footer;
  const back = <Button variant="ghost" onClick={() => { setView(null); setError(''); }} disabled={!!busy}>Back</Button>;

  if (view === 'score') {
    body = (
      <>
        <p style={{ ...hintText, marginTop: 0 }}>
          Recording {target.name}'s scores on their behalf - no login needed for them. Any scoring link they hold stops working.
        </p>
        <ScoreForm criteria={round.criteria} ratings={ratings} onRatingsChange={setRatings}
          score={scoreValue} onScoreChange={setScoreValue} comments={comments} onCommentsChange={setComments} />
      </>
    );
    footer = <>{back}<Button onClick={submitScore} loading={busy === 'score'}>Save score</Button></>;
  } else if (view === 'reschedule') {
    body = (
      <>
        {conflicts && <ConflictList conflicts={conflicts} />}
        <TextField label="New date and time" type="datetime-local" value={newDate} onChange={(e) => { setNewDate(e.target.value); setConflicts(null); }} required />
        <Select label="Length" value={newDuration} onChange={(e) => { setNewDuration(e.target.value); setConflicts(null); }}>
          {[15, 20, 30, 45, 60, 75, 90, 120, 180].map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </Select>
        <TextArea label="Reason (shared with the candidate)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={notifyPanel} onChange={(e) => setNotifyPanel(e.target.checked)} /> Email the panel an updated calendar invite
        </label>
      </>
    );
    footer = (
      <>
        {back}
        {conflicts && <Button variant="danger" onClick={() => submitReschedule(true)} loading={busy === 'reschedule'}>Reschedule anyway</Button>}
        {!conflicts && <Button onClick={() => submitReschedule(false)} loading={busy === 'reschedule'}>Reschedule</Button>}
      </>
    );
  } else if (view === 'cancel') {
    body = (
      <>
        <p style={{ marginTop: 0 }}>The candidate goes back to where they were before this round, and every outstanding scoring link stops working.</p>
        <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} hint="Kept in the audit trail and shared with the candidate" />
      </>
    );
    footer = <>{back}<Button variant="danger" loading={busy === 'cancel'} disabled={!reason.trim()}
      onClick={() => act('cancel', () => staffClient.patch(`/api/interviews/${round.id}/cancel`, { reason }), 'Interview cancelled. The candidate and panel have been told.')}>Cancel interview</Button></>;
  } else if (view === 'noShow') {
    body = (
      <>
        <p style={{ marginTop: 0 }}>
          Record that {app.candidate.fullName} did not attend. They are not notified - decide next whether to offer another round or reject the application.
        </p>
        <TextArea label="Notes (optional, audit trail only)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </>
    );
    footer = <>{back}<Button variant="danger" loading={busy === 'noShow'}
      onClick={() => act('noShow', () => staffClient.patch(`/api/interviews/${round.id}/no-show`, { notes }), 'Recorded as a no-show.')}>Record no-show</Button></>;
  } else if (view === 'finalize') {
    body = (
      <>
        {!progress.complete && <Alert type="warning" message={`Only ${progress.scored} of ${progress.total} panel scores are in. You can still finalize, but the average may change the picture.`} />}
        {round.highSpread && <Alert type="warning" message={`The panel's scores are ${progress.spread} points apart - worth a word with the chair before deciding.`} />}
        <p style={{ marginTop: 0 }}>
          Panel average <strong>{round.score != null ? round.score : '—'}</strong>. The recommendation is your judgement informed by the panel, not an automatic cut-off.
          {' '}<em>Reject</em> rejects the application and tells the candidate; <em>Shortlist</em> makes them eligible for an offer recommendation.
        </p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }} role="radiogroup" aria-label="Recommendation">
          {['Shortlist', 'Hold', 'Reject'].map((r) => (
            <button key={r} type="button" role="radio" aria-checked={recommendation === r} onClick={() => setRecommendation(r)} style={chipStyle(recommendation === r)}>{r}</button>
          ))}
        </div>
        <TextArea label="Notes for the record (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </>
    );
    footer = <>{back}<Button loading={busy === 'finalize'} variant={recommendation === 'Reject' ? 'danger' : 'primary'}
      onClick={() => act('finalize', () => staffClient.patch(`/api/interviews/${round.id}/finalize`, { recommendation, notes }), `Recommendation finalized: ${recommendation}.`)}>Finalize: {recommendation}</Button></>;
  } else if (view === 'recuse') {
    body = (
      <>
        <p style={{ marginTop: 0 }}>{target.name} stands down for this candidate (e.g. a declared conflict of interest). Their score, if any, stops counting and their link stops working.</p>
        <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </>
    );
    footer = <>{back}<Button variant="danger" loading={busy === 'recuse'} disabled={!reason.trim()}
      onClick={() => act('recuse', () => staffClient.patch(`/api/interviews/panel-members/${target.id}/recuse`, { reason }), `${target.name} has stood down.`)}>Stand down</Button></>;
  } else if (view === 'addPanelist') {
    body = (
      <>
        {conflicts && <ConflictList conflicts={conflicts} />}
        <TextField label="Name" required value={newPanelist.name} onChange={(e) => setNewPanelist({ ...newPanelist, name: e.target.value })} />
        <TextField label="Role / trade" value={newPanelist.trade} onChange={(e) => setNewPanelist({ ...newPanelist, trade: e.target.value })} />
        <TextField label="Email (optional)" type="email" value={newPanelist.email} onChange={(e) => setNewPanelist({ ...newPanelist, email: e.target.value })}
          hint="They get the calendar invite straight away" />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={newPanelist.isChair} onChange={(e) => setNewPanelist({ ...newPanelist, isChair: e.target.checked })} /> Chair the panel
        </label>
      </>
    );
    const addPanelist = async (force) => {
      setBusy('add'); setError('');
      try {
        await staffClient.post(`/api/interviews/${round.id}/panel-members`, { ...newPanelist, allowConflicts: force });
        await afterChange(`${newPanelist.name} added to the panel.`);
      } catch (err) {
        if (err.response?.data?.code === 'SCHEDULE_CONFLICT') setConflicts(err.response.data.conflicts);
        setError(errorMessage(err, 'Could not add the panelist'));
      } finally {
        setBusy(null);
      }
    };
    footer = <>{back}<Button loading={busy === 'add'} disabled={!newPanelist.name.trim()} onClick={() => addPanelist(!!conflicts)}>{conflicts ? 'Add anyway' : 'Add panelist'}</Button></>;
  } else {
    // -------------------------------------------------------- main view
    const panelTab = (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}><strong>{progress.scored}</strong> of {progress.total} scores in</span>
          <ProgressBar scored={progress.scored} total={progress.total} />
          <span style={{ fontSize: 14 }}>Average <strong>{round.score != null ? round.score : '—'}</strong></span>
          {round.highSpread && (
            <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: 'var(--color-warning)' }}>
              <AlertTriangle size={13} /> Panel disagrees ({progress.spread} pts apart, flag at {HIGH_SPREAD})
            </span>
          )}
        </div>

        {round.panelMembers.length === 0 && <p style={hintText}>No panel yet. Add who will sit on it.</p>}
        {round.panelMembers.map((m) => {
          const recused = !!m.recusedAt;
          return (
            <div key={m.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 8, opacity: recused ? 0.65 : 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                    {m.isChair && <Crown size={14} color="var(--color-gold-dark)" aria-label="Chair" />}
                    {m.name}{m.trade && <span style={{ ...hintText, fontWeight: 400 }}>· {m.trade}</span>}
                  </div>
                  <div style={hintText}>
                    {m.email || 'No email on file'}
                    {!recused && m.score == null && m.activeLinkExpiresAt && <> · scoring link sent (valid until {new Date(m.activeLinkExpiresAt).toLocaleDateString()})</>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {recused && <StatusBadge status="Cancelled" label="Stood down" />}
                  {!recused && m.score != null && (
                    <span style={{ fontSize: 18, fontWeight: 700 }}>{m.score}<span style={{ ...hintText, fontWeight: 400 }}> /100</span></span>
                  )}
                  {!recused && m.score == null && <StatusBadge status="Pending" label="Awaiting score" />}
                </div>
              </div>
              {recused && <div style={{ ...hintText, marginTop: 4 }}>Reason: {m.recusalReason}</div>}
              {!recused && m.score != null && (
                <div style={{ fontSize: 13, marginTop: 6 }}>
                  {round.criteria && m.criterionScores && (
                    <div style={{ ...hintText, marginBottom: 4 }}>
                      {round.criteria.map((c) => `${c.name}: ${m.criterionScores[c.id] ?? '—'}/5`).join(' · ')}
                    </div>
                  )}
                  {m.comments && <div style={{ fontStyle: 'italic' }}>"{m.comments}"</div>}
                  <div style={hintText}>{m.selfSubmitted ? 'Submitted by the panelist' : 'Recorded by HR'}{m.submittedAt ? ` · ${formatDateTime(m.submittedAt)}` : ''}</div>
                </div>
              )}
              {canEdit && scheduled && !recused && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button type="button" style={chipStyle(false)} onClick={() => open('score', m)}><PenLine size={12} /> {m.score == null ? 'Record score' : 'Correct score'}</button>
                  {m.score == null && (
                    <button type="button" style={chipStyle(false)} disabled={busy === `link-${m.id}`} onClick={() => sendOneLink(m)}>
                      {m.email ? <Mail size={12} /> : <Link2 size={12} />} {busy === `link-${m.id}` ? 'Sending...' : m.activeLinkExpiresAt ? 'Resend link' : 'Send scoring link'}
                    </button>
                  )}
                  {!m.isChair && (
                    <button type="button" style={chipStyle(false)} onClick={() => act(`chair-${m.id}`, () => staffClient.patch(`/api/interviews/panel-members/${m.id}`, { isChair: true }), `${m.name} now chairs the panel.`)}>
                      <Crown size={12} /> Make chair
                    </button>
                  )}
                  <button type="button" style={chipStyle(false)} onClick={() => open('recuse', m)}><UserMinus size={12} /> Stand down</button>
                  {m.score == null && (
                    <button type="button" style={{ ...chipStyle(false), color: 'var(--color-danger)' }}
                      onClick={() => act(`remove-${m.id}`, () => staffClient.delete(`/api/interviews/panel-members/${m.id}`), `${m.name} removed from the panel.`)}>
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {linkResults?.some((r) => !r.emailed) && (
          <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 8 }}>
            <span style={sectionLabel}>Links to share by hand (single-use, 14 days)</span>
            {linkResults.filter((r) => !r.emailed).map((r) => (
              <div key={r.panelMemberId} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, width: 140, flexShrink: 0 }}>{r.name}</span>
                <input readOnly value={r.url} onFocus={(e) => e.target.select()} style={{ ...inputStyle, flex: 1, fontSize: 12 }} aria-label={`Scoring link for ${r.name}`} />
                <button type="button" style={chipStyle(false)} onClick={() => navigator.clipboard?.writeText(r.url)}>Copy</button>
              </div>
            ))}
          </div>
        )}

        {round.criterionAverages?.some((c) => c.average != null) && (
          <div style={{ marginTop: 12 }}>
            <span style={sectionLabel}>Rubric averages (1-5)</span>
            {round.criterionAverages.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ width: 180, flexShrink: 0 }}>{c.name} <span style={hintText}>×{c.weight}</span></span>
                <div style={{ flex: 1, height: 8, background: 'var(--color-bg-subtle)', borderRadius: 999 }}>
                  <div style={{ width: `${((c.average || 0) / 5) * 100}%`, height: '100%', borderRadius: 999, background: 'var(--color-primary)' }} />
                </div>
                <span style={{ width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.average ?? '—'}</span>
              </div>
            ))}
          </div>
        )}

        {canEdit && scheduled && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Button variant="secondary" onClick={() => open('addPanelist')}>Add panelist</Button>
            {round.panelMembers.some((m) => m.score == null && !m.recusedAt) && (
              <Button variant="secondary" onClick={sendLinks} loading={busy === 'links'}>
                <Mail size={14} /> Send scoring links to everyone outstanding
              </Button>
            )}
          </div>
        )}
      </div>
    );

    const detailsTab = details && (
      <div>
        <Select label="Length" value={details.durationMinutes} disabled={!canEdit || !scheduled} onChange={(e) => setDetails({ ...details, durationMinutes: e.target.value })}>
          {[15, 20, 30, 45, 60, 75, 90, 120, 180].map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </Select>
        <span style={sectionLabel}>Format</span>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {MODES.map((m) => (
            <button key={m} type="button" disabled={!canEdit || !scheduled} onClick={() => setDetails({ ...details, mode: m })} style={chipStyle(details.mode === m)}>{m}</button>
          ))}
        </div>
        {details.mode === 'In-person' && <TextField label="Venue" value={details.location} disabled={!canEdit || !scheduled} onChange={(e) => setDetails({ ...details, location: e.target.value })} />}
        {details.mode === 'Virtual' && <TextField label="Meeting link" value={details.meetingLink} disabled={!canEdit || !scheduled} onChange={(e) => setDetails({ ...details, meetingLink: e.target.value })} />}
        <TextArea label="Instructions for the candidate" value={details.instructions} disabled={!canEdit || !scheduled} onChange={(e) => setDetails({ ...details, instructions: e.target.value })} />
        <TextArea label="Internal notes (HR only)" value={details.internalNotes} disabled={!canEdit || !scheduled} onChange={(e) => setDetails({ ...details, internalNotes: e.target.value })} />
        <RubricEditor value={details.criteria} onChange={(criteria) => setDetails({ ...details, criteria })} disabled={!canEdit || !scheduled || anyScored} />
        {canEdit && scheduled && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginTop: 12 }}>
            <input type="checkbox" checked={details.notifyParticipants} onChange={(e) => setDetails({ ...details, notifyParticipants: e.target.checked })} />
            Tell the candidate and panel if the venue, link, length or instructions change
          </label>
        )}
      </div>
    );

    body = (
      <>
        {header}
        <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', marginBottom: 12 }}>
          {[['panel', 'Panel & scores'], ['details', 'Details']].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)} style={{
              background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
              borderBottom: `2px solid ${tab === key ? 'var(--color-primary)' : 'transparent'}`,
              color: tab === key ? 'var(--color-primary-dark)' : 'var(--color-text-muted)', fontWeight: 600
            }}>{label}</button>
          ))}
        </div>
        {tab === 'panel' ? panelTab : detailsTab}
      </>
    );

    footer = (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
        {round.scheduledDate && round.status !== 'NoShow' && (
          <Button variant="ghost" onClick={downloadIcs} title="Download a calendar file"><Download size={14} /> .ics</Button>
        )}
        {canEdit && scheduled && tab === 'details' && <Button onClick={saveDetails} loading={busy === 'details'}>Save details</Button>}
        {canEdit && scheduled && tab === 'panel' && (
          <>
            <Button variant="ghost" onClick={() => open('cancel')}>Cancel</Button>
            {started && <Button variant="ghost" onClick={() => open('noShow')}>No-show</Button>}
            <Button variant="secondary" onClick={() => open('reschedule')}>Reschedule</Button>
            <Button onClick={() => open('finalize')} disabled={progress.scored === 0} title={progress.scored === 0 ? 'Needs at least one panel score' : undefined}>
              Finalize
            </Button>
          </>
        )}
      </div>
    );
  }

  const titles = {
    score: `Score — ${target?.name}`, reschedule: 'Reschedule interview', cancel: 'Cancel interview', noShow: 'Record a no-show',
    finalize: 'Finalize the panel\'s recommendation', recuse: `Stand down — ${target?.name}`, addPanelist: 'Add a panelist'
  };

  return (
    <Modal
      title={view ? titles[view] : `${app.candidate.fullName} — round ${round.roundNumber}`}
      onClose={onClose} maxWidth={760} footer={footer}
    >
      {!view && <div style={{ ...hintText, marginTop: -8, marginBottom: 8 }}>{app.vacancy.jobRef} · {app.vacancy.title}</div>}
      <Alert type="error" message={error} />
      <Alert type="success" message={notice} />
      {body}
    </Modal>
  );
}
