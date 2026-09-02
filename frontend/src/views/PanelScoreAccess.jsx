import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import TextArea from '../components/TextArea';
import Button from '../components/Button';
import Alert from '../components/Alert';

// Public page - a panelist reaches this via their emailed/shared link,
// with no account and no login. The token in the URL is the only
// credential; the backend scopes what this page can see and do.
export default function PanelScoreAccess() {
  const { token } = useParams();
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [score, setScore] = useState('');
  const [comments, setComments] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    client.get(`/api/panel-access/${token}`)
      .then((res) => setContext(res.data))
      .catch((err) => setError(err.response?.data?.error || 'This link is not valid.'));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await client.patch(`/api/panel-access/${token}/score`, { score: Number(score), comments });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit your score.');
    }
  };

  if (error && !context) {
    return (
      <div style={{ maxWidth: 420 }}>
        <PageHeader title="Interview scoring" />
        <Alert type="error" message={error} />
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ maxWidth: 420 }}>
        <PageHeader title="Thank you" />
        <Alert type="success" message="Your score has been recorded. You may close this page." />
      </div>
    );
  }

  if (!context) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 420 }}>
      <PageHeader
        title="Interview scoring"
        subtitle={`Hi ${context.panelistName}, please score this candidate's interview.`}
      />
      <Card>
        <p style={{ marginTop: 0 }}>
          <strong>{context.candidateName}</strong> &mdash; {context.vacancyTitle}
        </p>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Round {context.roundNumber}
          {context.scheduledDate && ` \u00b7 ${new Date(context.scheduledDate).toLocaleDateString()}`}
          {context.mode && ` \u00b7 ${context.mode}`}
        </p>
      </Card>
      <form onSubmit={handleSubmit}>
        <TextField label="Score (0-100)" type="number" min="0" max="100" value={score}
          onChange={(e) => setScore(e.target.value)} required />
        <TextArea label="Comments" value={comments} onChange={(e) => setComments(e.target.value)} />
        <Button type="submit">Submit score</Button>
      </form>
      <Alert type="error" message={error} />
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        This link can only be used once. Submitting will complete your part of this interview.
      </p>
    </div>
  );
}
