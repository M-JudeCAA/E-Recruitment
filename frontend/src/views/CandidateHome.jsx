import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, FileText, CalendarClock, Award, MapPin, Calendar, ArrowRight, Video } from 'lucide-react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import CandidateSidebar from '../components/CandidateSidebar';
import Card from '../components/Card';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import ProgressRing from '../components/ProgressRing';
import LoadingState from '../components/LoadingState';
import { getProfileCompletionPercent } from '../utils/profileCompleteness';

function KpiCard({ icon: Icon, label, value, accent, loading, to }) {
  const body = (
    <Card accent={accent} style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-subtle)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}
        >
          <Icon size={22} color={accent} />
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>
            {loading ? '—' : value}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
        </div>
      </div>
    </Card>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none' }}>{body}</Link> : body;
}

// Default landing page after candidate login (see CandidateLogin.jsx). A
// real overview now rather than also carrying the full job listing (that
// moved to its own "Find Jobs" stop, CandidateJobs.jsx, reachable from
// CandidateSidebar) - this page's job is to answer "what needs my
// attention right now", not to be the search/browse surface itself.
export default function CandidateHome() {
  const { candidate } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [applications, setApplications] = useState([]);
  const [loadingApplications, setLoadingApplications] = useState(true);

  // The completeness ring below is this page's only profile-editing
  // entry point now - "Edit profile" always sends the candidate to the
  // dedicated /dashboard/profile page (CandidateProfile.jsx), never an
  // in-place modal, so there's exactly one place profile data is edited
  // from. The New User path (first login) still gets the standalone
  // /profile/complete page - see ProfileCompletePage.jsx - unaffected.
  const [profilePercent, setProfilePercent] = useState(null);

  useEffect(() => {
    const params = candidate ? { candidateType: candidate.candidateType } : {};
    client.get('/api/vacancies', { params })
      .then((res) => setVacancies(res.data))
      .finally(() => setLoadingJobs(false));
    client.get('/api/candidates/me/applications')
      .then((res) => setApplications(res.data))
      .finally(() => setLoadingApplications(false));
    client.get('/api/candidates/me')
      .then((res) => setProfilePercent(getProfileCompletionPercent(res.data)));
  }, [candidate]);

  // findByCandidate (applicationModel.js) already includes interviewRounds
  // and offer on every application - both were fetched here before but
  // only used for a bare count. Surfacing the nearest upcoming interview
  // and how many offers are actually awaiting a response turns this into
  // the "what needs my attention" view a dashboard should be, using data
  // the API was already returning.
  const upcomingInterviews = useMemo(() => {
    const now = new Date();
    return applications
      .flatMap((app) => (app.interviewRounds || []).map((round) => ({ app, round })))
      .filter(({ round }) => round.scheduledDate && new Date(round.scheduledDate) >= now)
      .sort((a, b) => new Date(a.round.scheduledDate) - new Date(b.round.scheduledDate));
  }, [applications]);

  const offersToRespond = useMemo(
    () => applications.filter((app) => app.offer?.status === 'Approved'),
    [applications]
  );

  const nextInterview = upcomingInterviews[0];
  const recentVacancies = vacancies.slice(0, 4);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <CandidateSidebar active="home" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 'var(--spacing-lg)' }}>
            <h1 style={{ margin: 0, color: 'var(--color-primary-dark)' }}>
              Welcome{candidate?.fullName ? `, ${candidate.fullName.split(' ')[0]}` : ''}
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>
              Here's what needs your attention today.
            </p>
          </div>

          {profilePercent !== null && (
            <Card style={{ marginBottom: 'var(--spacing-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <ProgressRing
                  percent={profilePercent}
                  color={profilePercent === 100 ? 'var(--color-accent)' : 'var(--color-primary)'}
                />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700 }}>Profile completeness</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {profilePercent === 100
                      ? 'Your profile is complete.'
                      : 'A complete profile is what every application is built from.'}
                  </div>
                </div>
                <Link to="/dashboard/profile" style={{ textDecoration: 'none' }}>
                  <Button variant={profilePercent === 100 ? 'secondary' : 'primary'}>Edit profile</Button>
                </Link>
              </div>
            </Card>
          )}

          {nextInterview && (
            <Card accent="var(--color-warning)" style={{ marginBottom: 'var(--spacing-md)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <CalendarClock size={22} color="var(--color-warning)" />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700 }}>Upcoming interview — {nextInterview.app.vacancy.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    Round {nextInterview.round.roundNumber} &middot;{' '}
                    {new Date(nextInterview.round.scheduledDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    {nextInterview.round.mode && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        &middot; {nextInterview.round.mode.toLowerCase().includes('virtual') || nextInterview.round.mode.toLowerCase().includes('online')
                          ? <Video size={13} /> : <MapPin size={13} />} {nextInterview.round.mode}
                      </span>
                    )}
                  </div>
                </div>
                <Link to="/dashboard/applications" style={{ textDecoration: 'none' }}>
                  <Button variant="secondary" style={{ padding: '6px 14px', fontSize: 13 }}>View details</Button>
                </Link>
              </div>
            </Card>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--spacing-md)',
              marginBottom: 'var(--spacing-lg)'
            }}
          >
            <KpiCard
              icon={Briefcase}
              label="Available Jobs"
              value={vacancies.length}
              accent="var(--color-primary)"
              loading={loadingJobs}
              to="/dashboard/jobs"
            />
            <KpiCard
              icon={FileText}
              label="My Applications"
              value={applications.length}
              accent="var(--color-accent)"
              loading={loadingApplications}
              to="/dashboard/applications"
            />
            <KpiCard
              icon={CalendarClock}
              label="Interviews Scheduled"
              value={upcomingInterviews.length}
              accent="var(--color-warning)"
              loading={loadingApplications}
              to="/dashboard/applications"
            />
            <KpiCard
              icon={Award}
              label="Offers to Respond To"
              value={offersToRespond.length}
              accent="var(--color-accent)"
              loading={loadingApplications}
              to="/dashboard/applications"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)' }}>
            <h3 style={{ margin: 0 }}>Recently posted jobs</h3>
            <Link to="/dashboard/jobs" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
              View all jobs <ArrowRight size={14} />
            </Link>
          </div>

          {loadingJobs && <LoadingState label="Loading open vacancies..." />}
          {!loadingJobs && recentVacancies.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No open vacancies right now — check back soon.</p>
          )}

          {!loadingJobs && recentVacancies.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 'var(--spacing-md)',
              }}
            >
              {recentVacancies.map((v) => (
                <Card key={v.id} style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {v.jobRef ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{v.jobRef}: </span> : null}
                    {v.title}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {v.department?.name && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MapPin size={14} /> {v.department.name}
                      </span>
                    )}
                    {v.deadline && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={14} /> Closes {new Date(v.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <span><StatusBadge status={v.status} /></span>
                  </div>
                  <Link to={`/apply/${v.id}`} style={{ marginTop: 'auto', textDecoration: 'none' }}>
                    <Button style={{ width: '100%' }}>Apply Now</Button>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
