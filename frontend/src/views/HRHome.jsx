import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, FileText, Clock, AlertTriangle, CalendarClock } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useDashboardEvents } from '../models/dashboardSocket';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import LiveIndicator from '../components/LiveIndicator';
import FollowUpsPanel from '../components/FollowUpsPanel';
import StatsStrip from '../components/StatsStrip';
import Skeleton from '../components/Skeleton';
import StatusDonutChart from '../components/charts/StatusDonutChart';
import MiniSparkline from '../components/charts/MiniSparkline';
import { debounce } from '../utils/debounce';

function KpiCard({ icon: Icon, label, value, accent, loading, sparkline }) {
  return (
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>
            {loading ? '—' : value}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
        </div>
        {sparkline}
      </div>
    </Card>
  );
}

// Time-of-day greeting + role, using AuthContext's already-loaded staff
// session - no extra request.
function GreetingHeader({ staff, connected }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = staff?.name?.split(' ')[0] || 'there';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 'var(--spacing-lg)' }}>
      <div>
        <h2 style={{ margin: 0, color: 'var(--color-text)' }}>{greeting}, {firstName}</h2>
        {staff?.role && (
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
            {staff.role.replace(/_/g, ' ')}
          </p>
        )}
      </div>
      <LiveIndicator connected={connected} />
    </div>
  );
}

const VACANCY_STATUS_ORDER = ['PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed'];

const MS_PER_DAY = 86400000;

// Shared by ClosingSoon/RecentVacancies/UpcomingInterviews below - all
// three render the same two-line-per-row link list, so one skeleton mimics
// all of them rather than a plain "Loading…" string per card. See
// Skeleton.jsx's own comment for why.
function PanelRowsSkeleton() {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
          <Skeleton width={`${60 - i * 8}%`} height={14} style={{ marginBottom: 6 }} />
          <Skeleton width="35%" height={12} />
        </div>
      ))}
    </div>
  );
}

// Open/PartiallyFilled vacancies with a deadline in the next 7 days,
// soonest first - derived entirely from the vacancy list HRHome already
// fetches for the KPI cards, so this costs no extra request.
function ClosingSoon({ vacancies, loading }) {
  const now = Date.now();
  const items = vacancies
    .filter((v) => (v.status === 'Open' || v.status === 'PartiallyFilled') && v.deadline)
    .map((v) => ({ ...v, daysLeft: Math.ceil((new Date(v.deadline).getTime() - now) / MS_PER_DAY) }))
    .filter((v) => v.daysLeft >= 0 && v.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  return (
    <Card accent="var(--color-warning)" style={{ marginBottom: 0, flex: '1 1 320px', minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Closing soon
      </div>
      {loading ? (
        <PanelRowsSkeleton />
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Nothing closing in the next 7 days.</p>
      ) : (
        <div className="panel-scroll">
          {items.map((v, i) => (
            <Link
              key={v.id}
              to={`/hr/vacancy/${v.id}`}
              style={{
                display: 'block', padding: '8px 0',
                borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                textDecoration: 'none', color: 'inherit'
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{v.title}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {v.department?.name}
                {' '}&middot;{' '}
                {v.daysLeft === 0 ? 'Closes today' : v.daysLeft === 1 ? 'Closes tomorrow' : `Closes in ${v.daysLeft} days`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// Most recently created vacancies - findManyForAdmin already orders by
// createdAt desc, so this is just the first slice, no re-sorting needed.
function RecentVacancies({ vacancies, loading }) {
  const items = vacancies.slice(0, 5);

  return (
    <Card style={{ marginBottom: 0, flex: '1 1 320px', minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Recent vacancies
      </div>
      {loading ? (
        <PanelRowsSkeleton />
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No vacancies created yet.</p>
      ) : (
        <div className="panel-scroll">
          {items.map((v, i) => (
            <Link
              key={v.id}
              to={`/hr/vacancy/${v.id}`}
              style={{
                display: 'block', padding: '8px 0',
                borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                textDecoration: 'none', color: 'inherit'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{v.title}</div>
                <StatusBadge status={v.status} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {v.department?.name} &middot; {v._count?.applications ?? 0} application{v._count?.applications === 1 ? '' : 's'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// Interview rounds scheduled in the next 7 days, across every vacancy -
// what to walk into this week, without hunting through HRDashboard's
// interviews tab (which lists every round ever scheduled, not just what's
// imminent).
function UpcomingInterviews({ items, loading }) {
  return (
    <Card style={{ marginBottom: 0, flex: '1 1 320px', minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Upcoming interviews (7 days)
      </div>
      {loading ? (
        <PanelRowsSkeleton />
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Nothing scheduled in the next 7 days.</p>
      ) : (
        <div className="panel-scroll">
          {items.map((r, i) => (
            <Link
              key={r.id}
              to={`/hr/applications?vacancyId=${r.vacancyId}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                textDecoration: 'none', color: 'inherit'
              }}
            >
              <CalendarClock size={15} color="var(--color-primary)" style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.candidateName} &middot; {r.vacancyTitle}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Round {r.roundNumber} &middot; {r.mode || 'mode TBC'}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0, textAlign: 'right' }}>
                {r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'unscheduled'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// Screening pass/fail/not-yet-screened counts plus the most common failure
// categories - "are our requirements too strict" is invisible without
// this; screeningPassed/screeningReasons only populate once a vacancy's
// review has started (see applicationDraftController.submit).
function ScreeningBreakdown({ data, loading }) {
  const stats = data ? [
    { label: 'Passed', value: data.passed, color: 'var(--color-accent)' },
    { label: 'Failed', value: data.failed, color: 'var(--color-danger)' },
    { label: 'Not yet screened', value: data.notYetScreened, color: 'var(--color-text-muted)' }
  ] : [];

  return (
    <Card style={{ marginBottom: 0, flex: '1 1 320px', minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Screening breakdown
      </div>
      {loading ? (
        <div style={{ display: 'flex', gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1 }}>
              <Skeleton width="70%" height={11} style={{ marginBottom: 8 }} />
              <Skeleton width="45%" height={20} />
            </div>
          ))}
        </div>
      ) : !data || (data.passed + data.failed + data.notYetScreened) === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No applications have entered review yet.</p>
      ) : (
        <>
          <StatsStrip stats={stats} />
          {data.topReasons.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {data.topReasons.slice(0, 4).map((r) => (
                <span
                  key={r.key}
                  style={{
                    fontSize: 12, color: 'var(--color-text-muted)', background: 'var(--color-bg-subtle)',
                    borderRadius: 999, padding: '3px 10px'
                  }}
                >
                  {r.label} ({r.count})
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// Default landing page after HR login (see StaffLogin.jsx and Navbar.jsx's
// logo link). "Available" matches vacancyController.listPublic's own
// definition (status Open or PartiallyFilled) rather than inventing a new
// one. Total Applications is cross-vacancy - GET /api/applications/count
// does the aggregation in one query rather than fetching every vacancy's
// application list client-side and summing (the N+1 this used to do).
// The status breakdown / closing-soon / recent-vacancies widgets below are
// all derived from the same vacancy list fetched for the KPI cards, so the
// richer page still costs exactly the same two requests as before.
export default function HRHome() {
  const { staff } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [applicationCount, setApplicationCount] = useState(0);
  const [trends, setTrends] = useState(null);
  const [followUps, setFollowUps] = useState(null);
  const [upcomingInterviews, setUpcomingInterviews] = useState([]);
  const [screeningData, setScreeningData] = useState(null);
  const [loadingVacancies, setLoadingVacancies] = useState(true);
  const [loadingApplications, setLoadingApplications] = useState(true);
  const [loadingFollowUps, setLoadingFollowUps] = useState(true);
  const [loadingInterviews, setLoadingInterviews] = useState(true);
  const [loadingScreening, setLoadingScreening] = useState(true);
  const [error, setError] = useState('');

  const loadVacancies = useCallback(() => {
    staffClient.get('/api/vacancies/admin')
      .then((res) => setVacancies(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load vacancies'))
      .finally(() => setLoadingVacancies(false));
  }, []);
  const loadApplicationCount = useCallback(() => {
    staffClient.get('/api/applications/count')
      .then((res) => setApplicationCount(res.data.count))
      .catch((err) => setError(err.response?.data?.error || 'Could not load applications'))
      .finally(() => setLoadingApplications(false));
  }, []);
  const loadTrends = useCallback(() => {
    staffClient.get('/api/dashboard/trends', { params: { days: 14 } })
      .then((res) => setTrends(res.data))
      .catch(() => {}); // sparkline is a nice-to-have, never worth an error banner
  }, []);
  const loadFollowUps = useCallback(() => {
    staffClient.get('/api/dashboard/follow-ups')
      .then((res) => setFollowUps(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load follow-ups'))
      .finally(() => setLoadingFollowUps(false));
  }, []);
  const loadUpcomingInterviews = useCallback(() => {
    staffClient.get('/api/dashboard/upcoming-interviews')
      .then((res) => setUpcomingInterviews(res.data))
      .catch(() => {}) // nice-to-have panel, never worth an error banner
      .finally(() => setLoadingInterviews(false));
  }, []);
  const loadScreeningBreakdown = useCallback(() => {
    staffClient.get('/api/dashboard/screening-breakdown')
      .then((res) => setScreeningData(res.data))
      .catch(() => {})
      .finally(() => setLoadingScreening(false));
  }, []);

  useEffect(() => { loadVacancies(); }, [loadVacancies]);
  useEffect(() => { loadApplicationCount(); }, [loadApplicationCount]);
  useEffect(() => { loadTrends(); }, [loadTrends]);
  useEffect(() => { loadFollowUps(); }, [loadFollowUps]);
  useEffect(() => { loadUpcomingInterviews(); }, [loadUpcomingInterviews]);
  useEffect(() => { loadScreeningBreakdown(); }, [loadScreeningBreakdown]);

  // Any dashboard-relevant broadcast could plausibly move one of these
  // figures (a new application, a vacancy moving in/out of PendingApproval,
  // an approval resolving a follow-up, a newly-scheduled interview) -
  // refetching everything on every event is simpler and cheap enough than
  // mapping each event name to a narrower subset, and a debounced burst
  // still only fires once.
  const refetchAll = useCallback(debounce(() => {
    loadVacancies(); loadApplicationCount(); loadTrends(); loadFollowUps();
    loadUpcomingInterviews(); loadScreeningBreakdown();
  }, 500), [loadVacancies, loadApplicationCount, loadTrends, loadFollowUps, loadUpcomingInterviews, loadScreeningBreakdown]);
  const { connected } = useDashboardEvents(refetchAll);

  const availableJobs = vacancies.filter((v) => v.status === 'Open' || v.status === 'PartiallyFilled').length;
  const pendingApproval = vacancies.filter((v) => v.status === 'PendingApproval').length;
  // Still Open/PartiallyFilled (Vacancy.status is never mutated just
  // because a deadline lapsed - see scripts/checkVacancyDeadlines.js's own
  // comment) but past its deadline - candidates can no longer apply, so
  // this is specifically "needs your attention", not just "closed".
  const deadlinesPassed = vacancies.filter((v) =>
    v.deadline && new Date(v.deadline) < new Date() && (v.status === 'Open' || v.status === 'PartiallyFilled')
  ).length;

  const vacancyStatusCounts = VACANCY_STATUS_ORDER.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  vacancies.forEach((v) => { if (vacancyStatusCounts[v.status] != null) vacancyStatusCounts[v.status] += 1; });

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="home" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Alert type="error" message={error} />

          <GreetingHeader staff={staff} connected={connected} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--spacing-md)',
              marginBottom: 'var(--spacing-md)'
            }}
          >
            <KpiCard
              icon={Briefcase}
              label="Available Jobs"
              value={availableJobs}
              accent="var(--color-primary)"
              loading={loadingVacancies}
            />
            <KpiCard
              icon={FileText}
              label="Total Applications"
              value={applicationCount}
              accent="var(--color-accent)"
              loading={loadingApplications}
              sparkline={<MiniSparkline data={trends?.applicationsSubmitted} color="var(--color-accent)" />}
            />
            <KpiCard
              icon={Clock}
              label="Pending Approval"
              value={pendingApproval}
              accent="var(--color-warning)"
              loading={loadingVacancies}
            />
            <KpiCard
              icon={AlertTriangle}
              label="Deadlines Passed"
              value={deadlinesPassed}
              accent="var(--color-danger)"
              loading={loadingVacancies}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
            <StatusDonutChart
              title="Vacancy status breakdown"
              counts={vacancyStatusCounts}
              order={VACANCY_STATUS_ORDER}
              loading={loadingVacancies}
              emptyText="No vacancies yet."
            />
            <FollowUpsPanel
              items={followUps}
              loading={loadingFollowUps}
              actionable={false}
              emptyText="Nothing waiting on the team right now."
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
            <ClosingSoon vacancies={vacancies} loading={loadingVacancies} />
            <RecentVacancies vacancies={vacancies} loading={loadingVacancies} />
          </div>

          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
            <UpcomingInterviews items={upcomingInterviews} loading={loadingInterviews} />
            <ScreeningBreakdown data={screeningData} loading={loadingScreening} />
          </div>
        </div>
      </div>
    </div>
  );
}
