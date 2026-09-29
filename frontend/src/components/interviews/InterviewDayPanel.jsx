import React, { useCallback, useEffect, useState } from 'react';
import { PlayCircle, StopCircle, LogIn, UserX, ExternalLink, AlertTriangle } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Modal from '../Modal';
import Button from '../Button';
import Alert from '../Alert';
import StatusBadge from '../StatusBadge';
import LoadingState from '../LoadingState';
import { useConfirm } from '../ConfirmDialog';
import { hintText, chipStyle, ROUND_LABELS } from './formStyles';
import { formatTime, timeRange, errorMessage } from '../../utils/interviews';

// One vacancy's interview day, run as a session. HR starts it (which opens
// the panelists' day links for scoring), calls each candidate in as they
// enter the room (only then can the panel score them), and ends it -
// panelists get 15 minutes to finish scoring, then their links close. See
// backend interviewController getDay/startDay/endDay/callIn.

const NOT_STARTED_ALERT_MS = 30 * 60 * 1000;

function CandidateStatus({ round }) {
  if (round.status !== 'Scheduled') return <StatusBadge status={round.status} label={ROUND_LABELS[round.status]} />;
  if (!round.calledInAt) return <StatusBadge status="Pending" label="Waiting" />;
  return round.progress.complete
    ? <StatusBadge status="Completed" label="Scores in" />
    : <StatusBadge status="Scheduled" label={`Called in ${formatTime(round.calledInAt)}`} />;
}

export default function InterviewDayPanel({ vacancyId, day, canEdit, onClose, onOpenRound, onChanged, reloadKey }) {
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [notCalledIn, setNotCalledIn] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => staffClient.get(`/api/interviews/vacancies/${vacancyId}/days/${day}`)
    .then((res) => setData(res.data))
    .catch((err) => setError(errorMessage(err, 'Could not load this interview session'))), [vacancyId, day]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const act = async (key, request, success) => {
    setBusy(key); setError(''); setMessage('');
    try {
      const res = await request();
      setMessage(typeof success === 'function' ? success(res.data) : success);
      await load();
      onChanged?.();
      return res.data;
    } catch (err) {
      setError(errorMessage(err, 'That did not work - please try again'));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const start = () => act('start', () => staffClient.post(`/api/interviews/vacancies/${vacancyId}/days/${day}/start`),
    'Session started. Call each candidate in as they enter - panelists can score them from then on.');

  const end = async () => {
    const waiting = data.rounds.filter((r) => r.status === 'Scheduled' && !r.calledInAt).length;
    const ok = await confirm(
      'Panelists will have 15 minutes to finish scoring, then their links close.'
      + (waiting ? ` ${waiting} candidate${waiting === 1 ? ' has' : 's have'} not been called in - you will need to reschedule them or mark them as no-shows.` : ''),
      { title: 'End interview session', confirmLabel: 'End session', danger: true }
    );
    if (!ok) return;
    const result = await act('end', () => staffClient.post(`/api/interviews/vacancies/${vacancyId}/days/${day}/end`),
      'Session ended. Panelists have 15 minutes to finish scoring.');
    if (result) setNotCalledIn(result.notCalledIn);
  };

  const callIn = (round) => act(`call-${round.id}`, () => staffClient.patch(`/api/interviews/${round.id}/call-in`),
    `${round.application.candidate.fullName} called in - the panel can score them now.`);

  const noShow = async (round) => {
    const ok = await confirm(`Record that ${round.application.candidate.fullName} did not attend?`,
      { title: 'Mark as no-show', confirmLabel: 'Mark no-show', danger: true });
    if (!ok) return;
    await act(`noshow-${round.id}`, () => staffClient.patch(`/api/interviews/${round.id}/no-show`, {}),
      `${round.application.candidate.fullName} marked as a no-show.`);
  };

  const title = data ? `Interview session - ${data.vacancy.jobRef} ${data.vacancy.title}` : 'Interview session';
  const session = data?.session;
  const running = session?.state === 'running';
  const late = data && session.state === 'notStarted' && data.firstStart
    && Date.now() - new Date(data.firstStart).getTime() >= NOT_STARTED_ALERT_MS;

  return (
    <Modal title={title} onClose={onClose} maxWidth={760}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {!data && !error && <LoadingState label="Loading the session..." />}
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />
      {data && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{data.dayLabel}</div>
              <div style={hintText}>
                {session.state === 'notStarted' && `Not started${data.firstStart ? ` - first interview due at ${formatTime(data.firstStart)}` : ''}. Panelists cannot score until it is started.`}
                {session.state === 'running' && `Running since ${formatTime(session.startedAt)}${session.startedBy ? ` (started by ${session.startedBy})` : ''}.`}
                {session.state === 'ending' && `Ended at ${formatTime(session.endedAt)}. Panel links close at ${formatTime(session.closesAt)}.`}
                {session.state === 'closed' && (session.endedAt ? `Ended at ${formatTime(session.endedAt)}. Panel links are closed.` : 'This day is over. Panel links are closed.')}
              </div>
            </div>
            {canEdit && session.state === 'notStarted' && (
              <Button onClick={start} loading={busy === 'start'} loadingText="Starting..." disabled={!data.isToday}
                title={data.isToday ? undefined : 'A session can only be started on the day'}>
                <PlayCircle size={16} /> Start interview session
              </Button>
            )}
            {canEdit && running && (
              <Button variant="danger" onClick={end} loading={busy === 'end'} loadingText="Ending...">
                <StopCircle size={16} /> End session
              </Button>
            )}
          </div>

          {late && (
            <Alert type="warning" message={`This session is more than 30 minutes late.${session.notStartedAlertAt ? ' Whoever scheduled it has been notified.' : ''} Start it now, or reschedule or cancel the interviews.`} />
          )}
          {notCalledIn?.length > 0 && (
            <Alert type="warning" message={`Never called in: ${notCalledIn.map((r) => r.candidateName).join(', ')}. Reschedule them or mark them as no-shows.`} />
          )}

          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
            {data.rounds.length === 0 && <p style={{ ...hintText, padding: 12, margin: 0 }}>No interviews for this vacancy on this day.</p>}
            {data.rounds.map((r, i) => (
              <div key={r.id} style={{
                display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                padding: '10px 12px', borderTop: i ? '1px solid var(--color-border)' : 'none'
              }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{timeRange(r)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.application.candidate.fullName}</span>
                  <span style={{ ...hintText, marginLeft: 6 }}>round {r.roundNumber}</span>
                  <span style={{ display: 'block', ...hintText }}>
                    {ROUND_LABELS[r.candidateResponse] || r.candidateResponse}
                    {r.calledInAt && ` · panel ${r.progress.scored}/${r.progress.total} scored`}
                    {r.highSpread && <> · <AlertTriangle size={11} /> split panel</>}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <CandidateStatus round={r} />
                  {canEdit && running && r.status === 'Scheduled' && !r.calledInAt && (
                    <>
                      <button type="button" style={chipStyle(true)} disabled={busy === `call-${r.id}`} onClick={() => callIn(r)}>
                        <LogIn size={12} /> {busy === `call-${r.id}` ? 'Calling in...' : 'Call in'}
                      </button>
                      <button type="button" style={chipStyle(false)} disabled={busy === `noshow-${r.id}`} onClick={() => noShow(r)}>
                        <UserX size={12} /> No-show
                      </button>
                    </>
                  )}
                  <button type="button" style={chipStyle(false)} onClick={() => onOpenRound(r.id)} aria-label={`Open ${r.application.candidate.fullName}'s interview`}>
                    <ExternalLink size={12} /> Open
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
