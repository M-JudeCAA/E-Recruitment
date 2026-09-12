import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Video, MapPin, Award, ClipboardList } from 'lucide-react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import CandidateSidebar from '../components/CandidateSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import LoadingState from '../components/LoadingState';

const CLOSED_STATUSES = ['Rejected', 'Withdrawn'];
const REVIEW_STATUSES = ['Submitted', 'UnderReview', 'Shortlisted'];
const INTERVIEW_STATUSES = ['InterviewScheduled', 'Interviewed'];

// Client-side only - findByCandidate (applicationModel.js) already returns
// every application in one call, so filtering a tab doesn't need a new
// request, just a different slice of what's already in memory.
const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'drafts', label: 'Drafts', test: (a) => a.status === 'Draft' },
  { key: 'review', label: 'In Review', test: (a) => REVIEW_STATUSES.includes(a.status) },
  { key: 'interviews', label: 'Interviews', test: (a) => INTERVIEW_STATUSES.includes(a.status) || a.interviewRounds?.length > 0 },
  { key: 'offers', label: 'Offers', test: (a) => a.status === 'Offered' || !!a.offer },
  { key: 'closed', label: 'Closed', test: (a) => CLOSED_STATUSES.includes(a.status) },
];

function InterviewRoundRow({ round }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13,
      color: 'var(--color-text-muted)', padding: '6px 0'
    }}>
      <CalendarClock size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        <strong style={{ color: 'var(--color-text)' }}>Round {round.roundNumber}</strong>
        {round.scheduledDate ? ` — ${new Date(round.scheduledDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ' — date to be confirmed'}
        {round.mode && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
            {round.mode.toLowerCase().includes('virtual') || round.mode.toLowerCase().includes('online')
              ? <Video size={13} /> : <MapPin size={13} />}
            {round.mode}
          </span>
        )}
      </span>
    </div>
  );
}

function OfferPanel({ offer, onRespond, busy }) {
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
      background: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', flexWrap: 'wrap', gap: 10
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
        <Award size={16} color="var(--color-accent)" /> Offer <StatusBadge status={offer.status} />
      </span>
      {offer.status === 'Approved' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button loading={busy === 'accept'} onClick={() => onRespond('accept')}>Accept offer</Button>
          <Button variant="ghost" loading={busy === 'decline'} onClick={() => onRespond('decline')}>Decline</Button>
        </div>
      )}
    </div>
  );
}

// Candidate-level profile fields used to be edited from a form embedded at
// the top of this page; they now have their own "My Profile" sidebar stop
// (CandidateProfile.jsx), so this page can focus purely on what its name
// says - tracking the status of every application, including interview
// schedule and offer details that findByCandidate already returns but
// were previously left unsurfaced here.
export default function CandidateApplications() {
  const { candidate } = useAuth();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [offerMessage, setOfferMessage] = useState('');
  const [withdrawMessage, setWithdrawMessage] = useState('');
  const [busyOfferId, setBusyOfferId] = useState(null);

  const loadApplications = () => client.get('/api/candidates/me/applications')
    .then((res) => setApplications(res.data))
    .finally(() => setLoading(false));

  useEffect(() => {
    loadApplications();
  }, [candidate]);

  const counts = useMemo(() => {
    const c = {};
    FILTERS.forEach(({ key, test }) => { c[key] = applications.filter(test).length; });
    return c;
  }, [applications]);

  const visible = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)?.test || (() => true);
    return applications.filter(test);
  }, [applications, filter]);

  const respondToOffer = async (offerId, action) => {
    setOfferMessage('');
    setBusyOfferId(`${offerId}-${action}`);
    try {
      await client.patch(`/api/applications/offers/${offerId}/${action}`);
      setOfferMessage(action === 'accept' ? 'Offer accepted. Congratulations!' : 'Offer declined.');
      await loadApplications();
    } catch (err) {
      setOfferMessage(err.response?.data?.error || 'Could not record your response');
    } finally {
      setBusyOfferId(null);
    }
  };

  // Cancelling a Draft deletes it outright - HR never saw it, so a
  // candidate who changes their mind can start a genuinely fresh
  // application to the same vacancy afterward. Withdrawing a Submitted
  // application is a one-way door instead: the row is kept (as
  // Withdrawn), and re-applying to that vacancy is refused - it's a real,
  // HR-visible commitment being backed out of, not a form thrown away.
  const cancelDraft = async (applicationId) => {
    if (!window.confirm('Cancel this draft? You can start a fresh application to this vacancy afterward.')) return;
    setWithdrawMessage('');
    try {
      await client.patch(`/api/applications/${applicationId}/withdraw`);
      loadApplications();
    } catch (err) {
      setWithdrawMessage(err.response?.data?.error || 'Could not cancel draft');
    }
  };

  const withdrawApplication = async (applicationId) => {
    if (!window.confirm('Withdraw this application? This cannot be undone, and you will not be able to re-apply to this vacancy.')) return;
    setWithdrawMessage('');
    try {
      await client.patch(`/api/applications/${applicationId}/withdraw`);
      loadApplications();
    } catch (err) {
      setWithdrawMessage(err.response?.data?.error || 'Could not withdraw');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <CandidateSidebar active="applications" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="My applications" subtitle="Track every application, interview, and offer in one place." />

          <Alert type="info" message={offerMessage} />
          <Alert type="info" message={withdrawMessage} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
            {FILTERS.map(({ key, label }) => (
              <Button
                key={key}
                variant={filter === key ? 'primary' : 'ghost'}
                style={{ padding: '6px 14px', fontSize: 13 }}
                onClick={() => setFilter(key)}
              >
                {label} {applications.length > 0 && <span style={{ opacity: 0.75 }}>({counts[key]})</span>}
              </Button>
            ))}
          </div>

          {loading && <LoadingState label="Loading your applications..." />}

          {!loading && applications.length === 0 && (
            <Card style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>
              <ClipboardList size={28} color="var(--color-text-muted)" style={{ marginBottom: 8 }} />
              <p style={{ color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
                You haven't applied to any vacancies yet.
              </p>
              <Link to="/dashboard/jobs" style={{ textDecoration: 'none' }}>
                <Button>Browse open jobs</Button>
              </Link>
            </Card>
          )}

          {!loading && applications.length > 0 && visible.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No applications in this category.</p>
          )}

          {visible.map((app) => (
            <Card key={app.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong>{app.vacancy.title}</strong>
                  {app.submittedDate && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      Submitted {new Date(app.submittedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <StatusBadge status={app.status} />
              </div>

              {app.status === 'Draft' && (
                <div style={{ marginTop: 10 }}>
                  <Link to={`/apply/${app.vacancy.id}`} style={{ marginRight: 8 }}>Continue draft</Link>
                  <Button variant="ghost" style={{ padding: '2px 10px', color: 'var(--color-danger)' }}
                    onClick={() => cancelDraft(app.id)}>Cancel</Button>
                </div>
              )}

              {app.interviewRounds?.length > 0 && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                  {app.interviewRounds
                    .slice()
                    .sort((a, b) => a.roundNumber - b.roundNumber)
                    .map((round) => <InterviewRoundRow key={round.id} round={round} />)}
                </div>
              )}

              {app.offer && (
                <OfferPanel
                  offer={app.offer}
                  busy={busyOfferId?.startsWith(`${app.offer.id}-`) ? busyOfferId.split('-')[1] : null}
                  onRespond={(action) => respondToOffer(app.offer.id, action)}
                />
              )}

              {app.status === 'Submitted' && (
                <div style={{ marginTop: 10 }}>
                  <Button variant="ghost" style={{ padding: '2px 10px', color: 'var(--color-danger)' }}
                    onClick={() => withdrawApplication(app.id)}>Withdraw</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
