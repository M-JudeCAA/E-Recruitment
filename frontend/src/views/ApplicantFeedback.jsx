import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Star, AlertTriangle } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import CsvDownloadButton from '../components/CsvDownloadButton';
import BarList from '../components/charts/BarList';
import { PageTop, Panel, Figures, Table, SidePanel, KeyValues, Pill } from '../components/workspace/ui';

// Applicant feedback (/hr/feedback, every HR role and system administrators):
// the short survey internal candidates answer after submitting an
// application (views/careers/ApplicantSurvey.jsx; backend
// services/applicantSurveyService.js) - averages, how the ratings spread,
// how long applying took, and every response without the candidate's name.

const QUESTIONS = [
  { key: 'overallRating', label: 'Overall experience' },
  { key: 'easeRating', label: 'Ease of applying' },
  { key: 'clarityRating', label: 'Clear instructions' }
];
const RATING_WORDS = ['Very poor', 'Poor', 'Fair', 'Good', 'Very good'];

const when = (value) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const tone = (n) => (n >= 4 ? 'ok' : n === 3 ? 'neutral' : 'bad');
const outOfFive = (v) => (v == null ? '—' : `${v} / 5`);
const clip = (text, max = 90) => (text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text);

export default function ApplicantFeedback() {
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const load = useCallback(() => {
    setError('');
    staffClient.get(`/api/feedback/application-surveys${query ? `?${query}` : ''}`)
      .then((r) => setData(r.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load the feedback'));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const summary = data?.summary;
  const field = (key) => ({ value: filters[key], onChange: (e) => setFilters((f) => ({ ...f, [key]: e.target.value })) });

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="feedback" />
      <div className="ws-page" style={{ flex: 1, minWidth: 0 }}>
        <PageTop
          title="Applicant feedback"
          subtitle="What UCAA employees said about applying through the system - the short survey offered after they submit an application on Internal Careers"
          actions={<CsvDownloadButton url={`/api/feedback/application-surveys/export${query ? `?${query}` : ''}`} label="Export CSV" fallbackName="applicant-feedback.csv" />}
        />
        <div className="ws-toolbar" style={{ marginBottom: 'var(--spacing-md)' }}>
          <label className="ws-note">From <input className="ws-field" type="date" aria-label="From" {...field('from')} /></label>
          <label className="ws-note">To <input className="ws-field" type="date" aria-label="To" {...field('to')} /></label>
        </div>
        <Alert type="error" message={error} />
        {!data && !error && <Skeleton height={240} />}
        {summary && (
          <>
            <Figures figures={[
              { label: 'Responses', value: summary.responses, icon: MessageSquare },
              ...QUESTIONS.map((q) => ({ label: q.label, value: outOfFive(summary.averages[q.key]), note: 'average', icon: Star })),
              { label: 'Had a problem', value: summary.hadProblems, note: summary.responses ? `${Math.round((summary.hadProblems / summary.responses) * 100)}% of responses` : null, icon: AlertTriangle }
            ]} />
            {summary.responses > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                {QUESTIONS.map((q) => (
                  <Panel key={q.key} title={q.label} note="Number of responses at each rating">
                    <BarList max={summary.responses} rows={summary.distribution[q.key].map((count, i) => ({ key: String(i + 1), label: `${i + 1} - ${RATING_WORDS[i]}`, value: count })).reverse()} />
                  </Panel>
                ))}
                <Panel title="Time taken to apply" note="As the applicant remembered it">
                  <BarList max={summary.responses} rows={summary.timeTaken.map((t) => ({ key: t.key, label: t.label, value: t.count }))} />
                </Panel>
              </div>
            )}
            <Panel title="Responses" note="Newest first. Open one to read it in full." padded={false} style={{ marginTop: 'var(--spacing-md)' }}>
              <Table
                rows={data.responses}
                getRowKey={(r) => r.id}
                onRowClick={setOpen}
                noun="responses"
                emptyText="No feedback yet. Internal candidates are offered the survey after they submit an application."
                columns={[
                  { key: 'submittedAt', label: 'Given', render: (r) => when(r.submittedAt), width: 150 },
                  { key: 'vacancy', label: 'Vacancy', render: (r) => r.vacancyTitle },
                  ...QUESTIONS.map((q) => ({ key: q.key, label: q.label, render: (r) => <Pill tone={tone(r[q.key])}>{r[q.key]}</Pill> })),
                  { key: 'problems', label: 'Problem', render: (r) => (r.hadProblems ? <Pill tone="warn">Yes</Pill> : 'No') },
                  { key: 'comment', label: 'Comments', render: (r) => <span className="ws-note">{clip([r.problems, r.suggestions].filter(Boolean).join(' / ')) || '—'}</span> }
                ]}
              />
            </Panel>
          </>
        )}
        {open && (
          <SidePanel title="Feedback" eyebrow={when(open.submittedAt)} onClose={() => setOpen(null)}>
            <KeyValues rows={[
              ['Vacancy', `${open.vacancyTitle}${open.jobRef ? ` (${open.jobRef})` : ''}`],
              ...QUESTIONS.map((q) => [q.label, `${open[q.key]} - ${RATING_WORDS[open[q.key] - 1]}`]),
              ['Time taken', open.timeTakenLabel || 'Not said'],
              ['Anything go wrong?', open.hadProblems ? 'Yes' : 'No'],
              ['What went wrong', open.problems ? <span style={{ whiteSpace: 'pre-wrap' }}>{open.problems}</span> : '—'],
              ['Suggestions', open.suggestions ? <span style={{ whiteSpace: 'pre-wrap' }}>{open.suggestions}</span> : '—']
            ]} />
          </SidePanel>
        )}
      </div>
    </div>
  );
}
