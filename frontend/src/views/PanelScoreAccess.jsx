import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarClock, MapPin, Video, Phone, Crown } from 'lucide-react';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextArea from '../components/TextArea';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import ScoreForm, { validateScore, previewScore } from '../components/interviews/ScoreForm';
import { formatDay, timeRange } from '../utils/interviews';

// Public page - a panelist reaches this via their emailed/shared link,
// with no account and no login. The token in the URL is the only
// credential; the backend scopes what this page can see and do. When the
// round has a rubric the panelist rates each criterion 1-5 and the score is
// computed from that; otherwise they give one overall score. They can also
// stand down (declare a conflict of interest) with the same link.
export default function PanelScoreAccess() {
  const { token } = useParams();
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [ratings, setRatings] = useState({});
  const [score, setScore] = useState('');
  const [comments, setComments] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [recusing, setRecusing] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(null);
  // A single-use link with no server-side guard against a double-click
  // beyond rejecting the second attempt outright - this is the local
  // first line of defense, same reasoning as ApplyForm.jsx's `continuing`.
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    client.get(`/api/panel-access/${token}`)
      .then((res) => setContext(res.data))
      .catch((err) => setError(err.response?.data?.error || 'This link is not valid.'));
  }, [token]);

  const hasRubric = context?.criteria?.length > 0;
  const finalScore = hasRubric ? previewScore(context.criteria, ratings) : Number(score);

  const review = (e) => {
    e.preventDefault();
    const problem = validateScore(context.criteria, ratings, score);
    if (problem) { setError(problem); return; }
    setError('');
    setReviewing(true);
  };

  const submit = async () => {
    setError(''); setSubmitting(true);
    try {
      await client.patch(`/api/panel-access/${token}/score`, hasRubric
        ? { criterionScores: ratings, comments }
        : { score: Number(score), comments });
      setDone('Your score has been recorded. Thank you - you may close this page.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit your score.');
      setReviewing(false);
    } finally {
      setSubmitting(false);
    }
  };

  const recuse = async () => {
    setError(''); setSubmitting(true);
    try {
      const res = await client.patch(`/api/panel-access/${token}/recuse`, { reason });
      setDone(res.data.message);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record that.');
    } finally {
      setSubmitting(false);
    }
  };

  const wrap = (children) => <div style={{ maxWidth: 620, margin: '0 auto' }}>{children}</div>;

  if (error && !context) {
    return wrap(<><PageHeader title="Interview scoring" /><Alert type="error" message={error} /></>);
  }
  if (done) {
    return wrap(<><PageHeader title="Thank you" /><Alert type="success" message={done} /></>);
  }
  if (!context) {
    return wrap(
      <>
        <Skeleton width={200} height={22} style={{ marginBottom: 8 }} />
        <Skeleton width={280} height={14} style={{ marginBottom: 20 }} />
        <Card>
          <Skeleton width={220} height={15} style={{ marginBottom: 8 }} />
          <Skeleton width={160} height={12} />
        </Card>
        <Skeleton width="100%" height={120} radius={6} style={{ marginTop: 16, marginBottom: 12 }} />
        <Skeleton width={130} height={36} radius={6} />
      </>
    );
  }

  const ModeIcon = context.mode === 'Virtual' ? Video : context.mode === 'Phone' ? Phone : MapPin;

  return wrap(
    <>
      <PageHeader
        title="Interview scoring"
        subtitle={`Hi ${context.panelistName}, please record your assessment of this candidate.`}
      />
      <Card>
        <p style={{ marginTop: 0, marginBottom: 6 }}>
          <strong>{context.candidateName}</strong> &mdash; {context.jobRef ? `${context.jobRef} ` : ''}{context.vacancyTitle}
        </p>
        <div style={{ display: 'grid', gap: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <CalendarClock size={14} /> Round {context.roundNumber}
            {context.scheduledDate && ` · ${formatDay(context.scheduledDate)}, ${timeRange(context)}`}
          </span>
          {context.mode && (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ModeIcon size={14} /> {context.mode}{context.location ? ` · ${context.location}` : ''}
            </span>
          )}
          {context.isChair && <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Crown size={14} /> You are chairing this panel.</span>}
        </div>
      </Card>

      <Alert type="error" message={error} />

      {recusing ? (
        <Card>
          <h3 style={{ marginTop: 0 }}>Stand down from this interview</h3>
          <p style={{ fontSize: 14 }}>
            If you know the candidate personally or have any other conflict of interest, say so here. You won't score this
            candidate, and your place is left out of the panel's average. This uses up your link.
          </p>
          <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setRecusing(false)} disabled={submitting}>Back to scoring</Button>
            <Button variant="danger" onClick={recuse} loading={submitting} disabled={reason.trim().length < 3}>Stand down</Button>
          </div>
        </Card>
      ) : reviewing ? (
        <Card>
          <h3 style={{ marginTop: 0 }}>Check before you submit</h3>
          {hasRubric && (
            <ul style={{ paddingLeft: 18, fontSize: 14 }}>
              {context.criteria.map((c) => <li key={c.id}>{c.name}: <strong>{ratings[c.id]}</strong> / 5</li>)}
            </ul>
          )}
          <p style={{ fontSize: 15 }}>Score: <strong>{finalScore} / 100</strong></p>
          {comments && <p style={{ fontSize: 14, fontStyle: 'italic' }}>"{comments}"</p>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>This link works once - after submitting you can't change your score without asking HR for a new link.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setReviewing(false)} disabled={submitting}>Edit</Button>
            <Button onClick={submit} loading={submitting} loadingText="Submitting...">Submit score</Button>
          </div>
        </Card>
      ) : (
        <form onSubmit={review}>
          {hasRubric && (
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              Rate each area from 1 (poor) to 5 (outstanding). Your overall score is worked out from the weights HR set.
            </p>
          )}
          <ScoreForm criteria={context.criteria} ratings={ratings} onRatingsChange={setRatings}
            score={score} onScoreChange={setScore} comments={comments} onCommentsChange={setComments} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button type="submit">Review and submit</Button>
            <Button type="button" variant="ghost" onClick={() => { setError(''); setRecusing(true); }}>I have a conflict of interest</Button>
          </div>
        </form>
      )}
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        This link can only be used once{context.expiresAt ? ` and expires on ${new Date(context.expiresAt).toLocaleDateString()}` : ''}.
      </p>
    </>
  );
}
