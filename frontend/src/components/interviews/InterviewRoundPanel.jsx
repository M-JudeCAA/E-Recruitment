import React, { useCallback, useEffect, useState } from 'react';
import {
  Crown, Mail, CalendarClock, MapPin, Video, Phone, Download, AlertTriangle, Trash2, PenLine, Users, FileText, ClipboardCheck
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
import {
  MODES, VERDICTS, formatDateTime, timeRange, formatDay, venueLabel, toLocalInput, fromLocalInput,
  saveCalendarFile, CONFLICT_LABELS, errorMessage
} from '../../utils/interviews';
import { fileLink } from '../../utils/fileLink';
import { validateSupportingDocumentFile } from '../../utils/fileValidation';
import { sectionLabel, hintText, chipStyle, ROUND_LABELS } from './formStyles';

// Matches backend/src/middleware/auth.js's ROLE_RANK - changing an interview
// is Senior HR Officer+; reading it, and recording the panel's results, any
// HR tier.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

const ModeIcon = ({ mode, size = 15 }) => (mode === 'Virtual' ? <Video size={size} /> : mode === 'Phone' ? <Phone size={size} /> : <MapPin size={size} />);

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
// The panel scores on paper, outside the system; HR records the overall
// score, the panel's verdict and the signed score sheet here afterwards.
export default function InterviewRoundPanel({ roundId, onClose, onChanged }) {
  const { staff } = useAuth();
  const canEdit = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;

  const [round, setRound] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState('panel');
  // Sub-views that replace the main content: results | reschedule | cancel | noShow | addPanelist
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
  const [scoreValue, setScoreValue] = useState('');
  const [sheet, setSheet] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [reason, setReason] = useState('');
  const [notifyPanel, setNotifyPanel] = useState(true);
  const [conflicts, setConflicts] = useState(null);
  const [recommendation, setRecommendation] = useState('Shortlist');
  const [notes, setNotes] = useState('');
  const [newPanelist, setNewPanelist] = useState({ name: '', trade: '', email: '', isChair: false });
  const [details, setDetails] = useState(null);

  const open = (v, t = null) => {
    setError(''); setNotice(''); setConflicts(null); setReason(''); setNotes(''); setTarget(t); setView(v);
    if (v === 'results') {
      setScoreValue(round.score ?? ''); setRecommendation(round.recommendation || ''); setNotes(round.resultNotes || ''); setSheet(null);
    }
    if (v === 'reschedule') {
      setNewDate(toLocalInput(round.scheduledDate)); setNewDuration(round.durationMinutes || 60); setNotifyPanel(true);
    }
    if (v === 'addPanelist') setNewPanelist({ name: '', trade: '', email: '', isChair: false });
  };

  useEffect(() => {
    if (round && tab === 'details') {
      setDetails({
        durationMinutes: round.durationMinutes || 60, mode: round.mode || 'In-person', location: round.location || '',
        meetingLink: round.meetingLink || '', instructions: round.instructions || '', internalNotes: round.internalNotes || '',
        notifyParticipants: true
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
  const canRecord = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.HR_Officer;
  const hasResults = round.status === 'Completed';
  // Matches recordResults on the backend: a rejection is final, and nothing
  // changes under a merit list or an offer.
  const correctionBlocker = !hasResults ? null
    : round.recommendation === 'Reject' ? 'A rejection is final - the candidate has been told.'
      : app.offer ? 'This candidate has an offer, so the results can no longer be corrected.'
        : app.meritStatus ? 'This candidate is on the merit list - re-propose the list without them before correcting their results.'
          : null;

  const downloadIcs = async () => {
    try {
      const res = await staffClient.get(`/api/interviews/${round.id}/calendar.ics`, { responseType: 'text' });
      saveCalendarFile(res.data, `interview-${round.id}.ics`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the calendar file'));
    }
  };

  const submitResults = async () => {
    const score = Number(scoreValue);
    if (scoreValue === '' || !Number.isFinite(score) || score < 0 || score > 100) { setError('Enter the overall score, from 0 to 100'); return; }
    if (!recommendation) { setError('Choose the panel\'s verdict'); return; }
    if (!hasResults && !sheet) { setError('Attach the signed score sheet'); return; }
    const body = new FormData();
    body.append('score', String(score));
    body.append('recommendation', recommendation);
    body.append('notes', notes);
    if (sheet) body.append('scoreSheet', sheet);
    await act('results', () => staffClient.patch(`/api/interviews/${round.id}/results`, body),
      hasResults ? 'Results corrected.'
        : recommendation === 'Reject' ? 'Results recorded. The application has been rejected and the candidate told.'
          : `Results recorded: ${recommendation}. ${app.candidate.fullName} can now go on the merit list.`);
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

  const saveDetails = () => act('details', () => staffClient.patch(`/api/interviews/${round.id}`, {
    durationMinutes: Number(details.durationMinutes), mode: details.mode,
    location: details.mode === 'In-person' ? details.location : null,
    meetingLink: details.mode === 'Virtual' ? details.meetingLink : null,
    instructions: details.instructions, internalNotes: details.internalNotes,
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
          <Users size={15} /> {round.panelMembers.length} panelist{round.panelMembers.length === 1 ? '' : 's'}{round.scheduledBy ? ` · booked by ${round.scheduledBy.name}` : ''}
        </span>
      </div>
      {round.candidateResponse === 'RescheduleRequested' && round.candidateResponseNote && (
        <Alert type="warning" message={`The candidate asked to move this interview: "${round.candidateResponseNote}"`} />
      )}
      {round.resultsDue && (
        <Alert type="warning" message="This interview has taken place. Record the panel's results from the signed score sheet, or record a no-show if the candidate didn't attend." />
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

  if (view === 'results') {
    const pickSheet = (e) => {
      const file = e.target.files?.[0] || null;
      const problem = validateSupportingDocumentFile(file);
      if (problem) { setError(problem); setSheet(null); e.target.value = ''; return; }
      setError(''); setSheet(file);
    };
    body = (
      <>
        <p style={{ ...hintText, marginTop: 0, fontSize: 13 }}>
          {hasResults
            ? 'Correct what was entered from the score sheet. The change is kept in the audit trail.'
            : <>Enter the results from the panel's signed score sheet for {app.candidate.fullName}. <em>Reject</em> rejects the application and tells the candidate; <em>Shortlist</em> and <em>Hold</em> make them eligible for the merit list.</>}
        </p>
        <TextField label="Overall score (out of 100)" type="number" min="0" max="100" step="0.1" required value={scoreValue}
          onChange={(e) => setScoreValue(e.target.value)} hint="As on the score sheet - usually the average of the panelists' totals" />
        <span style={sectionLabel}>Panel's verdict</span>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }} role="radiogroup" aria-label="Panel's verdict">
          {VERDICTS.filter((r) => !hasResults || r !== 'Reject').map((r) => (
            <button key={r} type="button" role="radio" aria-checked={recommendation === r} onClick={() => setRecommendation(r)} style={chipStyle(recommendation === r)}>{r}</button>
          ))}
        </div>
        <TextArea label="Panel's remarks (optional, HR only)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <label style={sectionLabel} htmlFor="score-sheet">
          Signed score sheet{hasResults ? ' (only to replace the one attached)' : ''}{!hasResults && <span style={{ color: 'var(--color-danger)' }}> *</span>}
        </label>
        <input id="score-sheet" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={pickSheet} style={{ fontSize: 14, marginBottom: 4 }} />
        <div style={hintText}>A scan or photo of the sheet the panel signed - PDF, Word, JPG or PNG, up to 10MB.{hasResults && round.scoreSheetName ? ` Attached now: ${round.scoreSheetName}.` : ''}</div>
      </>
    );
    footer = <>{back}<Button onClick={submitResults} loading={busy === 'results'} variant={recommendation === 'Reject' ? 'danger' : 'primary'}>
      {hasResults ? 'Save correction' : recommendation === 'Reject' ? 'Record results and reject' : 'Record results'}
    </Button></>;
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
        <p style={{ marginTop: 0 }}>The candidate goes back to where they were before this round. They and the panel get a calendar cancellation.</p>
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
    const resultsBlock = hasResults && (
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{round.score ?? '—'}<span style={{ ...hintText, fontWeight: 400 }}> /100</span></span>
          {round.recommendation && <StatusBadge status={round.recommendation} label={round.recommendation} />}
          {round.scoreSheetUrl && (
            <a href={fileLink(round.scoreSheetUrl)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 14 }}>
              <FileText size={14} /> Signed score sheet
            </a>
          )}
        </div>
        {round.resultNotes && <div style={{ fontSize: 14, marginTop: 8, fontStyle: 'italic' }}>"{round.resultNotes}"</div>}
        <div style={{ ...hintText, marginTop: 6 }}>
          Recorded{round.conductedBy ? ` by ${round.conductedBy.name}` : ''}{round.resultsRecordedAt ? ` · ${formatDateTime(round.resultsRecordedAt)}` : ''}
        </div>
        {canRecord && (
          correctionBlocker
            ? <div style={{ ...hintText, marginTop: 6 }}>{correctionBlocker}</div>
            : <button type="button" style={{ ...chipStyle(false), marginTop: 8 }} onClick={() => open('results')}><PenLine size={12} /> Correct results</button>
        )}
      </div>
    );

    const panelTab = (
      <div>
        {resultsBlock}
        <p style={{ ...hintText, marginTop: 0 }}>
          Panelists with an email get a calendar invitation for their interviews that day, updated if anything changes. They score on the paper score sheet.
        </p>
        {round.panelMembers.length === 0 && <p style={hintText}>No panel yet. Add who will sit on it.</p>}
        {round.panelMembers.map((m) => (
          <div key={m.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {m.isChair && <Crown size={14} color="var(--color-gold-dark)" aria-label="Chair" />}
                  {m.name}{m.trade && <span style={{ ...hintText, fontWeight: 400 }}>· {m.trade}</span>}
                </div>
                <div style={{ ...hintText, display: 'flex', gap: 4, alignItems: 'center' }}>
                  {m.email ? <><Mail size={11} /> {m.email}</> : 'No email - give them the details yourself'}
                </div>
              </div>
              {canEdit && scheduled && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!m.isChair && (
                    <button type="button" style={chipStyle(false)} onClick={() => act(`chair-${m.id}`, () => staffClient.patch(`/api/interviews/panel-members/${m.id}`, { isChair: true }), `${m.name} now chairs the panel.`)}>
                      <Crown size={12} /> Make chair
                    </button>
                  )}
                  <button type="button" style={{ ...chipStyle(false), color: 'var(--color-danger)' }}
                    onClick={() => act(`remove-${m.id}`, () => staffClient.delete(`/api/interviews/panel-members/${m.id}`),
                      `${m.name} removed from the panel.${m.email ? ' Their calendar has been updated.' : ''}`)}>
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {canEdit && scheduled && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Button variant="secondary" onClick={() => open('addPanelist')}>Add panelist</Button>
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
          {[['panel', hasResults ? 'Results & panel' : 'Panel'], ['details', 'Details']].map(([key, label]) => (
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
          </>
        )}
        {canRecord && scheduled && tab === 'panel' && (
          <Button onClick={() => open('results')} disabled={!started} title={started ? undefined : 'Once the interview has taken place'}>
            <ClipboardCheck size={14} /> Record results
          </Button>
        )}
      </div>
    );
  }

  const titles = {
    results: hasResults ? 'Correct the interview results' : 'Record the interview results',
    reschedule: 'Reschedule interview', cancel: 'Cancel interview', noShow: 'Record a no-show', addPanelist: 'Add a panelist'
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
