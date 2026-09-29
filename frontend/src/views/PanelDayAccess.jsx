import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarClock, MapPin, Video, Phone, Crown } from 'lucide-react';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextArea from '../components/TextArea';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import ScoreForm, { validateScore, previewScore } from '../components/interviews/ScoreForm';
import { formatTime, timeRange } from '../utils/interviews';

// Public page - a panelist's day link (no account, no login). One page for
// every candidate they interview for this vacancy on this day, in slot
// order. Scoring follows the session HR runs: nothing opens until HR starts
// it, and then each candidate only once HR calls them in. The page polls so
// a call-in shows up without a reload. Each candidate can be scored once;
// the panelist can stand down for any candidate not yet scored. The link
// closes 15 minutes after HR ends the session. See backend
// panelDayLinkService.js.

const POLL_MS = 20 * 1000;

const STATE_BADGES = {
  open: { status: 'Pending', label: 'Called in - score now' },
  waiting: { status: 'Scheduled', label: 'Waiting' },
  scored: { status: 'Completed', label: 'Scored' },
  recused: { status: 'Cancelled', label: 'Stood down' },
  cancelled: { status: 'Cancelled', label: 'Cancelled' },
  noShow: { status: 'NoShow', label: 'Did not attend' },
  closed: { status: 'Completed', label: 'Finalized' }
};

function CandidateCard({ token, candidate, sessionState, active, onOpen, onClose, onDone }) {
  const [mode, setMode] = useState('score'); // 'score' | 'review' | 'recuse'
  const [ratings, setRatings] = useState({});
  const [score, setScore] = useState('');
  const [comments, setComments] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hasRubric = candidate.criteria?.length > 0;
  const ModeIcon = candidate.mode === 'Virtual' ? Video : candidate.mode === 'Phone' ? Phone : MapPin;
  const badge = STATE_BADGES[candidate.state];
  const canScore = candidate.state === 'open';
  const canRecuse = candidate.state === 'open' || candidate.state === 'waiting';

  const openAs = (m) => {
    setMode(m); setError(''); setRatings({}); setScore(''); setComments(''); setReason('');
    onOpen();
  };

  const review = (e) => {
    e.preventDefault();
    const problem = validateScore(candidate.criteria, ratings, score);
    if (problem) { setError(problem); return; }
    setError('');
    setMode('review');
  };

  const send = async (path, body, message) => {
    setError(''); setSubmitting(true);
    try {
      await client.patch(`/api/panel-day/${token}/${path}`, { panelMemberId: candidate.panelMemberId, ...body });
      onDone(message);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong - please try again.');
      if (mode === 'review') setMode('score');
    } finally {
      setSubmitting(false);
    }
  };

  const submitScore = () => send('score', hasRubric ? { criterionScores: ratings, comments } : { score: Number(score), comments },
    `Your score for ${candidate.candidateName} has been recorded.`);
  const submitRecusal = () => send('recuse', { reason }, `You have stood down for ${candidate.candidateName}. HR has been told.`);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ marginTop: 0, marginBottom: 4, fontWeight: 600 }}>{candidate.candidateName}</p>
          <div style={{ display: 'grid', gap: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <CalendarClock size={14} /> {timeRange(candidate)}{candidate.roundNumber > 1 ? ` · round ${candidate.roundNumber}` : ''}
            </span>
            {candidate.mode && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <ModeIcon size={14} /> {candidate.mode}{candidate.location ? ` · ${candidate.location}` : ''}
              </span>
            )}
            {candidate.isChair && <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Crown size={14} /> You are chairing this panel.</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {badge && <StatusBadge status={badge.status} label={badge.label} />}
          {candidate.state === 'scored' && candidate.myScore != null && (
            <div style={{ fontSize: 13, marginTop: 4 }}>Your score: <strong>{candidate.myScore} / 100</strong></div>
          )}
        </div>
      </div>

      {!active && (canScore || canRecuse) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {canScore && <Button onClick={() => openAs('score')}>Score this candidate</Button>}
          {candidate.state === 'waiting' && (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {sessionState === 'notStarted'
                ? 'You can score once HR starts the session and calls this candidate in.'
                : 'You can score once HR calls this candidate in.'}
            </span>
          )}
          <Button variant="ghost" onClick={() => openAs('recuse')}>I have a conflict of interest</Button>
        </div>
      )}

      {active && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <Alert type="error" message={error} />
          {mode === 'recuse' && (
            <>
              <p style={{ fontSize: 14, marginTop: 0 }}>
                If you know this candidate personally or have any other conflict of interest, say so here. You won't score
                them, and your place is left out of the panel's average for this interview only.
              </p>
              <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button variant="danger" onClick={submitRecusal} loading={submitting} disabled={reason.trim().length < 3}>Stand down</Button>
              </div>
            </>
          )}
          {mode === 'review' && (
            <>
              <h3 style={{ marginTop: 0 }}>Check before you submit</h3>
              {hasRubric && (
                <ul style={{ paddingLeft: 18, fontSize: 14 }}>
                  {candidate.criteria.map((c) => <li key={c.id}>{c.name}: <strong>{ratings[c.id]}</strong> / 5</li>)}
                </ul>
              )}
              <p style={{ fontSize: 15 }}>Score: <strong>{hasRubric ? previewScore(candidate.criteria, ratings) : Number(score)} / 100</strong></p>
              {comments && <p style={{ fontSize: 14, fontStyle: 'italic' }}>"{comments}"</p>}
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>You can't change a score once it is submitted.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" onClick={() => setMode('score')} disabled={submitting}>Edit</Button>
                <Button onClick={submitScore} loading={submitting} loadingText="Submitting...">Submit score</Button>
              </div>
            </>
          )}
          {mode === 'score' && (
            <form onSubmit={review}>
              {hasRubric && (
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 0 }}>
                  Rate each area from 1 (poor) to 5 (outstanding). Your overall score is worked out from the weights HR set.
                </p>
              )}
              <ScoreForm criteria={candidate.criteria} ratings={ratings} onRatingsChange={setRatings}
                score={score} onScoreChange={setScore} comments={comments} onCommentsChange={setComments} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                <Button type="submit">Review and submit</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

export default function PanelDayAccess() {
  const { token } = useParams();
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeId, setActiveId] = useState(null);

  const load = useCallback(() => client.get(`/api/panel-day/${token}`)
    .then((res) => { setContext(res.data); setError(''); })
    .catch((err) => {
      // The link closing mid-day (grace period over, or HR revoked it)
      // replaces the page with the reason.
      setContext(null);
      setError(err.response?.data?.error || 'This link is not valid.');
    }), [token]);

  useEffect(() => { load(); }, [load]);
  // Polling pauses while a scoresheet is open, so a refresh can never
  // disturb what the panelist is typing.
  useEffect(() => {
    if (activeId) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, activeId]);

  const wrap = (children) => <div style={{ maxWidth: 680, margin: '0 auto' }}>{children}</div>;

  if (error && !context) {
    return wrap(<><PageHeader title="Interview scoring" /><Alert type="error" message={error} /></>);
  }
  if (!context) {
    return wrap(
      <>
        <Skeleton width={220} height={22} style={{ marginBottom: 8 }} />
        <Skeleton width={320} height={14} style={{ marginBottom: 20 }} />
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <Skeleton width={200} height={15} style={{ marginBottom: 8 }} />
            <Skeleton width={150} height={12} />
          </Card>
        ))}
      </>
    );
  }

  const remaining = context.candidates.filter((c) => c.state === 'open' || c.state === 'waiting').length;

  return wrap(
    <>
      <PageHeader
        title={`Interview scoring - ${context.dayLabel}`}
        subtitle={`Hi ${context.panelistName}, these are the candidates you interview for ${context.jobRef} ${context.vacancyTitle} on this day.`}
      />
      {context.sessionState === 'notStarted' && (
        <Alert type="info" message="The interview session has not started yet. You can look over your list now - each candidate opens for scoring once HR starts the session and calls them in." />
      )}
      {context.sessionState === 'ending' && (
        <Alert type="warning" message={`HR has ended the session. Finish any remaining scores before ${formatTime(context.closesAt)}, when this link closes.`} />
      )}
      <Alert type="success" message={message} />
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        Score each candidate after HR calls them in - each score can be submitted once. This page updates by itself.
        {remaining > 0 ? ` ${remaining} candidate${remaining === 1 ? '' : 's'} still to go.` : ' You have nothing left to score - thank you.'}
      </p>
      {context.candidates.map((c) => (
        <CandidateCard key={c.panelMemberId} token={token} candidate={c} sessionState={context.sessionState}
          active={activeId === c.panelMemberId}
          onOpen={() => { setMessage(''); setActiveId(c.panelMemberId); }}
          onClose={() => setActiveId(null)}
          onDone={(text) => { setActiveId(null); setMessage(text); load(); }} />
      ))}
    </>
  );
}
