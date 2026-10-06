import React, { useCallback, useEffect, useState } from 'react';
import { Home, Briefcase, FileText, User } from 'lucide-react';
import client from '../../models/apiClient';
import { useAuth } from '../../models/AuthContext';
import Sidebar from '../../components/Sidebar';
import { candidateOfferStatus } from '../../components/offers/offerFormat';
import { getMissingProfileFields } from '../../utils/profileCompleteness';
import { isInternalPort } from '../../internalPort';

// Shared by the candidate pages of both sites: Internal Careers
// (internalPort.js, /careers/*, UCAA employees) and the public careers
// site's signed-in area (/dashboard/*, /jobs/:id, /apply/:id, external
// applicants). The sidebar, the page frame, the data every page needs
// (profile, applications, open vacancies and how the candidate fits each),
// and the wording for an application's stage and the HR employment check.

/** Where each page lives and what it is called, per site. Internal-only parts check SITE.internal. */
export const SITE = isInternalPort() ? {
  internal: true, menuTitle: 'Internal Careers',
  home: '/careers', jobs: '/careers/vacancies', applications: '/careers/applications', profile: '/careers/profile',
  job: (id) => `/careers/vacancies/${id}`, apply: (id) => `/careers/apply/${id}`,
  jobsLabel: 'Vacancies', jobWord: 'vacancy', jobColumn: 'Vacancy',
  noJobs: 'No internal vacancies are open right now. New ones appear here as soon as they are advertised.'
} : {
  internal: false, menuTitle: 'Your career',
  home: '/dashboard', jobs: '/dashboard/jobs', applications: '/dashboard/applications', profile: '/dashboard/profile',
  job: (id) => `/jobs/${id}`, apply: (id) => `/apply/${id}`,
  jobsLabel: 'Find jobs', jobWord: 'job', jobColumn: 'Job',
  noJobs: 'No jobs are open right now. New ones appear here as soon as they are advertised.'
};

export function CareerSidebar({ active }) {
  const { candidate, logoutCandidate } = useAuth();
  const items = [
    { key: 'home', label: 'Home', icon: Home, to: SITE.home, section: SITE.menuTitle },
    { key: 'vacancies', label: SITE.jobsLabel, icon: Briefcase, to: SITE.jobs, section: SITE.menuTitle },
    { key: 'applications', label: 'My applications', icon: FileText, to: SITE.applications, section: SITE.menuTitle },
    { key: 'profile', label: 'My profile', icon: User, to: SITE.profile, section: 'Account' }
  ];
  const signOut = (
    <button type="button" onClick={logoutCandidate}
      style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', marginTop: 4, display: 'inline-block' }}>Sign out</button>
  );
  const footer = SITE.internal ? (
    <div className="ws-acting" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}>
      <b>Signed in with Microsoft</b><br />
      <span style={{ overflowWrap: 'anywhere' }}>{candidate?.email}</span><br />
      {signOut}
    </div>
  ) : (
    <div className="ws-acting" style={{ background: 'transparent', color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', borderRadius: 0 }}>
      <span style={{ overflowWrap: 'anywhere' }}>{candidate?.email}</span><br />
      {signOut}
      <div style={{ marginTop: 10 }}>Help: careers@caa.co.ug</div>
    </div>
  );
  return <Sidebar items={items} active={active} storageKey="careerSidebarCollapsed" width={236} title="Menu" variant="rail" mobileTrigger={false} footer={footer} />;
}

export function CareerShell({ active, children }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <CareerSidebar active={active} />
      <div className="ws-page" style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

const isOpen = (v) => !v.deadline || new Date(v.deadline) >= new Date();

/**
 * Profile, applications and the open vacancies this candidate may apply for
 * (closedVacancies: those whose deadline has passed), plus `fit`
 * ({ [vacancyId]: { eligible, reasons } } from GET
 * /api/applications/eligibility/:id) for the vacancies passed in `fitFor`
 * (or every open one with fitFor = 'open').
 */
export function useCareer({ fitFor = null } = {}) {
  const [me, setMe] = useState(null);
  const [applications, setApplications] = useState(null);
  const [vacancies, setVacancies] = useState(null);
  const [closedVacancies, setClosedVacancies] = useState([]);
  const [fit, setFit] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    return Promise.all([
      client.get('/api/candidates/me').then((r) => setMe(r.data)),
      client.get('/api/candidates/me/applications').then((r) => setApplications(r.data)),
      client.get('/api/vacancies').then((r) => {
        setVacancies(r.data.filter(isOpen));
        setClosedVacancies(r.data.filter((v) => !isOpen(v)));
      })
    ]).catch((err) => setError(err.response?.data?.error || 'Could not load your information'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const fitKey = fitFor === 'open' ? (vacancies || []).map((v) => v.id).join(',') : (fitFor || []).join(',');
  useEffect(() => {
    if (!fitKey) return;
    let cancelled = false;
    Promise.all(fitKey.split(',').map((id) => client.get(`/api/applications/eligibility/${id}`)
      .then((r) => [id, r.data]).catch(() => [id, null])))
      .then((pairs) => { if (!cancelled) setFit(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [fitKey]);

  return { me, applications, vacancies, closedVacancies, fit, error, reload: load };
}

/** The profile fields still missing, in words (the employment details counted separately). */
export function profileGaps(me) {
  const LABELS = {
    location: 'Place of residence', districtOfOrigin: 'District of origin', nationalId: 'National ID number (NIN)',
    education: 'At least one qualification', workExperience: 'Your work history'
  };
  const missing = getMissingProfileFields(me);
  return {
    employment: missing.some((m) => m.startsWith('internalProfile.')),
    personal: missing.filter((m) => LABELS[m]).map((m) => LABELS[m])
  };
}

/** What stage an application is at, as the employee sees it. */
export function stageOf(app) {
  if (app.status === 'Draft') return { label: 'Draft', tone: 'neutral' };
  if (app.status === 'Withdrawn') return { label: 'Withdrawn', tone: 'neutral' };
  if (app.status === 'Rejected') return { label: 'Not successful', tone: 'neutral' };
  if (app.offer) {
    const s = candidateOfferStatus(app.offer);
    if (s === 'Accepted') return { label: 'Offer accepted', tone: 'ok' };
    if (s === 'Approved') return { label: 'Offer to answer', tone: 'warn' };
    return { label: s === 'Declined' ? 'Offer declined' : s === 'Expired' ? 'Offer expired' : 'Offer withdrawn', tone: 'neutral' };
  }
  if (app.status === 'InterviewScheduled') return { label: 'Interview', tone: 'brand' };
  if (app.status === 'Interviewed') return { label: 'Interviewed', tone: 'info' };
  if (app.status === 'Shortlisted') return { label: 'Shortlisted', tone: 'brand' };
  return { label: 'Being reviewed', tone: 'info' };
}

/** HR's check of the employee's employment details (one per person, InternalProfile). */
export function employmentCheck(me, app) {
  if (app && app.status === 'Draft') return { label: 'Checked when you submit', tone: null };
  const p = me?.internalProfile;
  if (!p) return { label: '—', tone: null };
  if (p.verificationStatus === 'HR_Verified') return { label: p.verifiedDate ? `Verified ${formatDay(p.verifiedDate, true)}` : 'Verified', tone: 'ok' };
  if (p.verificationStatus === 'Discrepancy_Flagged') return { label: 'Doesn’t match HR records', tone: 'bad' };
  return { label: 'HR checking', tone: 'warn' };
}

export function formatDay(value, short = false) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', short ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysLeft(deadline) {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline) - new Date()) / 86400000);
}

/** Upcoming interview rounds that still need the employee's answer. */
export function interviewsToConfirm(applications) {
  return (applications || []).flatMap((a) => (a.interviewRounds || [])
    .filter((r) => r.status === 'Scheduled' && r.candidateResponse === 'Pending' && new Date(r.scheduledDate) > new Date())
    .map((r) => ({ app: a, round: r })));
}

/** The step list beside a wizard. steps: [{ label, note }]; a done step can be reopened with onGo. */
export function WizardRail({ steps, index, onGo }) {
  return (
    <div className="ws-panel">
      <ol className="ws-wsteps">
        {steps.map((s, i) => {
          const state = i < index ? 'done' : i === index ? 'now' : '';
          const go = onGo && i < index;
          return (
            <li key={s.label} className={`${state}${go ? ' go' : ''}`} onClick={go ? () => onGo(i) : undefined}
              role={go ? 'button' : undefined} tabIndex={go ? 0 : undefined}
              onKeyDown={go ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(i); } } : undefined}
              aria-current={i === index ? 'step' : undefined}>
              <span className="ic">{i < index ? '✓' : i + 1}</span>
              <span>{s.label}{s.note && <small>{s.note}</small>}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
