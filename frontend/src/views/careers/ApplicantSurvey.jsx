import React, { useEffect, useState } from 'react';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import TextArea from '../../components/TextArea';
import Modal from '../../components/Modal';

// The short survey that pops up on Internal Careers right after an
// application is submitted (CareerApply) - how applying through the system
// went, for the pilot review (backend services/applicantSurveyService.js).
// One per application, and skippable: Skip, the close button and a click
// outside all call onClose. HR and system administrators read the answers
// without the candidate's name (views/ApplicantFeedback.jsx).

const RATINGS = [
  { key: 'overallRating', text: 'Overall, how was applying through the system?' },
  { key: 'easeRating', text: 'How easy was it to find and fill in what was asked?' },
  { key: 'clarityRating', text: 'How clear were the instructions and wording?' }
];
const TIME_TAKEN = [
  { key: 'under15', label: 'Under 15 minutes' },
  { key: '15to30', label: '15 to 30 minutes' },
  { key: '30to60', label: '30 minutes to an hour' },
  { key: 'over60', label: 'More than an hour' }
];

function Scale({ label, value, onChange }) {
  return (
    <fieldset className="survey-q">
      <legend>{label}</legend>
      <div className="ws-chips survey-scale" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={`ws-chip${value === n ? ' on' : ''}`} onClick={() => onChange(n)}>{n}</button>
        ))}
        <span className="survey-ends">1 = very poor, 5 = very good</span>
      </div>
    </fieldset>
  );
}

function Choice({ label, options, value, onChange }) {
  return (
    <fieldset className="survey-q">
      <legend>{label}</legend>
      <div className="ws-chips survey-scale" role="radiogroup">
        {options.map((o) => (
          <button key={String(o.key)} type="button" role="radio" aria-checked={value === o.key} className={`ws-chip${value === o.key ? ' on' : ''}`} onClick={() => onChange(o.key)}>{o.label}</button>
        ))}
      </div>
    </fieldset>
  );
}

export default function ApplicantSurvey({ applicationId, onClose }) {
  const [state, setState] = useState('loading'); // loading | open | sent | hidden
  const [answers, setAnswers] = useState({ overallRating: null, easeRating: null, clarityRating: null, timeTaken: '', hadProblems: null, problems: '', suggestions: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (value) => { setAnswers((a) => ({ ...a, [key]: value })); setError(''); };

  useEffect(() => {
    if (!applicationId) return;
    client.get(`/api/feedback/application-survey/${applicationId}`)
      .then((r) => setState(r.data.answered ? 'hidden' : 'open'))
      .catch(() => setState('hidden'));
  }, [applicationId]);

  if (state === 'loading' || state === 'hidden') return null;
  if (state === 'sent') {
    return (
      <Modal title="Thank you" onClose={onClose} maxWidth={560} footer={<Button onClick={onClose}>Close</Button>}>
        <Alert type="success" message="Thank you for your feedback - it helps us improve the system." />
      </Modal>
    );
  }

  const complete = RATINGS.every((r) => answers[r.key]) && answers.hadProblems !== null;
  const send = async () => {
    if (!complete) { setError('Please answer the rating questions and say whether anything went wrong.'); return; }
    setBusy(true); setError('');
    try {
      await client.post('/api/feedback/application-survey', { applicationId, ...answers, timeTaken: answers.timeTaken || undefined });
      setState('sent');
    } catch (err) {
      if (err.response?.data?.code === 'SURVEY_ALREADY_ANSWERED') setState('sent');
      else setError(err.response?.data?.error || 'Could not send your feedback');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="How did applying go?"
      onClose={onClose}
      maxWidth={560}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Skip</Button>
          <Button onClick={send} loading={busy} loadingText="Sending...">Send feedback</Button>
        </>
      )}
    >
      <div className="survey">
        <div className="ws-note" style={{ marginBottom: 16 }}>Your application has been submitted. A short survey about using the system - about a minute. It is optional, has no effect on your application, and HR sees your answers without your name.</div>
        {RATINGS.map((r) => <Scale key={r.key} label={r.text} value={answers[r.key]} onChange={set(r.key)} />)}
        <Choice label="Roughly how long did it take you?" options={TIME_TAKEN} value={answers.timeTaken} onChange={set('timeTaken')} />
        <Choice label="Did anything go wrong or confuse you?" options={[{ key: true, label: 'Yes' }, { key: false, label: 'No' }]} value={answers.hadProblems} onChange={set('hadProblems')} />
        {answers.hadProblems && (
          <TextArea label="What went wrong, or what was confusing?" rows={3} maxLength={2000} value={answers.problems} onChange={(e) => set('problems')(e.target.value)} />
        )}
        <TextArea label="What would make applying better? (optional)" rows={3} maxLength={2000} value={answers.suggestions} onChange={(e) => set('suggestions')(e.target.value)} />
        <Alert type="error" message={error} />
      </div>
    </Modal>
  );
}
