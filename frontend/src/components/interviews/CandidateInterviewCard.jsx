import React, { useState } from 'react';
import { CalendarClock, Video, MapPin, Phone, CalendarPlus, CheckCircle2, Clock } from 'lucide-react';
import client from '../../models/apiClient';
import Button from '../Button';
import Modal from '../Modal';
import TextArea from '../TextArea';
import StatusBadge from '../StatusBadge';
import { formatDay, timeRange, saveCalendarFile, errorMessage } from '../../utils/interviews';

const STATUS_LABELS = { Scheduled: 'Upcoming', Held: 'Held', Cancelled: 'Cancelled', NoShow: 'Missed' };
// A virtual interview's Join button appears this long before it starts.
const JOIN_EARLY_MS = 15 * 60 * 1000;

// One interview round as the candidate sees it (fields whitelisted by the
// backend's utils/candidateInterview.js): when and where, what to bring,
// and - while it's upcoming - confirm, ask for another time, or add it to
// their calendar. onChanged reloads the page's applications.
export default function CandidateInterviewCard({ round, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');

  const upcoming = round.status === 'Scheduled' && (!round.scheduledDate || new Date(round.scheduledDate) > new Date());
  const startsAt = round.scheduledDate ? new Date(round.scheduledDate) : null;
  const canJoin = round.mode === 'Virtual' && round.meetingLink && round.status === 'Scheduled' && startsAt
    && Date.now() >= startsAt.getTime() - JOIN_EARLY_MS && Date.now() <= startsAt.getTime() + (round.durationMinutes || 60) * 60000;

  const respond = async (response, withNote) => {
    setBusy(response); setError('');
    try {
      await client.patch(`/api/candidates/me/interviews/${round.id}/respond`, { response, note: withNote });
      setAsking(false); setNote('');
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not send your reply'));
    } finally {
      setBusy(null);
    }
  };

  const addToCalendar = async () => {
    setBusy('ics'); setError('');
    try {
      const res = await client.get(`/api/candidates/me/interviews/${round.id}/calendar.ics`, { responseType: 'text' });
      saveCalendarFile(res.data, `ucaa-interview-${round.id}.ics`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the calendar file'));
    } finally {
      setBusy(null);
    }
  };

  const ModeIcon = round.mode === 'Virtual' ? Video : round.mode === 'Phone' ? Phone : MapPin;

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 8,
      background: upcoming ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)', opacity: round.status === 'Cancelled' ? 0.8 : 1
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ fontSize: 14 }}>Interview · round {round.roundNumber}</strong>
        <StatusBadge status={round.status} label={STATUS_LABELS[round.status] || round.status} />
      </div>

      <div style={{ display: 'grid', gap: 4, marginTop: 6, fontSize: 13 }}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <CalendarClock size={14} />
          {startsAt ? `${formatDay(startsAt)}, ${timeRange(round)}` : 'Date to be confirmed - HR will be in touch'}
        </span>
        {round.status !== 'Cancelled' && (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
            <ModeIcon size={14} />
            {round.mode === 'Virtual'
              ? (round.meetingLink ? <a href={round.meetingLink} target="_blank" rel="noreferrer">Online - joining link</a> : 'Online - the link will follow')
              : round.mode === 'Phone' ? 'By phone - HR will call you' : (round.location || 'In person - venue to follow')}
          </span>
        )}
        {round.instructions && round.status === 'Scheduled' && (
          <span style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text)' }}><strong>Please note:</strong> {round.instructions}</span>
        )}
        {round.status === 'Cancelled' && round.cancellationReason && (
          <span style={{ color: 'var(--color-text-muted)' }}>Reason: {round.cancellationReason}</span>
        )}
        {round.rescheduleCount > 0 && round.status === 'Scheduled' && (
          <span style={{ color: 'var(--color-text-muted)' }}>This interview's details have changed since it was first booked.</span>
        )}
      </div>

      {upcoming && (
        <div style={{ marginTop: 8 }}>
          {round.candidateResponse === 'Confirmed' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--color-accent)', marginBottom: 6 }}>
              <CheckCircle2 size={14} /> You confirmed you will attend.
            </div>
          )}
          {round.candidateResponse === 'RescheduleRequested' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 13, color: 'var(--color-warning)', marginBottom: 6 }}>
              <Clock size={14} style={{ marginTop: 2 }} /> You asked for another time. HR will be in touch - the time above stands until they change it.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canJoin && <a href={round.meetingLink} target="_blank" rel="noreferrer"><Button>Join now</Button></a>}
            {round.candidateResponse !== 'Confirmed' && startsAt && (
              <Button onClick={() => respond('Confirmed')} loading={busy === 'Confirmed'}>Confirm I'll attend</Button>
            )}
            {round.candidateResponse !== 'RescheduleRequested' && (
              <Button variant="ghost" onClick={() => { setAsking(true); setError(''); }}>Request another time</Button>
            )}
            {startsAt && (
              <Button variant="ghost" onClick={addToCalendar} loading={busy === 'ics'}><CalendarPlus size={14} /> Add to calendar</Button>
            )}
          </div>
        </div>
      )}
      {canJoin && !upcoming && (
        <div style={{ marginTop: 8 }}><a href={round.meetingLink} target="_blank" rel="noreferrer"><Button>Join now</Button></a></div>
      )}
      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 6 }}>{error}</div>}

      {asking && (
        <Modal
          title="Request another time"
          onClose={() => setAsking(false)}
          footer={<>
            <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
            <Button onClick={() => respond('RescheduleRequested', note)} loading={busy === 'RescheduleRequested'} disabled={note.trim().length < 5}>Send request</Button>
          </>}
        >
          <p style={{ marginTop: 0, fontSize: 14 }}>
            Tell HR why you can't make it and which days or times would suit you. Your interview stays booked until HR confirms a new time.
          </p>
          <TextArea label="Your message" required value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}
