import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, FileText, Clock, AlertTriangle } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Alert from '../components/Alert';
import StatusBadge, { STATUS_COLORS } from '../components/StatusBadge';

function KpiCard({ icon: Icon, label, value, accent, loading }) {
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
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>
            {loading ? '—' : value}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
        </div>
      </div>
    </Card>
  );
}

// Time-of-day greeting + role, using AuthContext's already-loaded staff
// session - no extra request.
function GreetingHeader({ staff }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = staff?.name?.split(' ')[0] || 'there';
  return (
    <div style={{ marginBottom: 'var(--spacing-lg)' }}>
      <h2 style={{ margin: 0, color: 'var(--color-text)' }}>{greeting}, {firstName}</h2>
      {staff?.role && (
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
          {staff.role.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  );
}

// Proportional bar + legend, reusing StatusBadge's own STATUS_COLORS so a
// status is always the same color everywhere it appears in the app.
const VACANCY_STATUS_ORDER = ['PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed'];

function StatusBreakdown({ vacancies, loading }) {
  const counts = VACANCY_STATUS_ORDER.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  vacancies.forEach((v) => { if (counts[v.status] != null) counts[v.status] += 1; });
  const total = vacancies.length;
  const present = VACANCY_STATUS_ORDER.filter((s) => counts[s] > 0);

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Vacancy status breakdown
      </div>
      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : total === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No vacancies yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--color-bg-subtle)' }}>
            {present.map((s) => (
              <div
                key={s}
                title={`${s.replace(/_/g, ' ')}: ${counts[s]}`}
                style={{ width: `${(counts[s] / total) * 100}%`, background: STATUS_COLORS[s] }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
            {present.map((s) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s], flexShrink: 0 }} />
                {s.replace(/_/g, ' ')} ({counts[s]})
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

const MS_PER_DAY = 86400000;

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
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Nothing closing in the next 7 days.</p>
      ) : (
        items.map((v, i) => (
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
        ))
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
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No vacancies created yet.</p>
      ) : (
        items.map((v, i) => (
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
        ))
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
  const [loadingVacancies, setLoadingVacancies] = useState(true);
  const [loadingApplications, setLoadingApplications] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    staffClient.get('/api/vacancies/admin')
      .then((res) => setVacancies(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load vacancies'))
      .finally(() => setLoadingVacancies(false));
  }, []);

  useEffect(() => {
    staffClient.get('/api/applications/count')
      .then((res) => setApplicationCount(res.data.count))
      .catch((err) => setError(err.response?.data?.error || 'Could not load applications'))
      .finally(() => setLoadingApplications(false));
  }, []);

  const availableJobs = vacancies.filter((v) => v.status === 'Open' || v.status === 'PartiallyFilled').length;
  const pendingApproval = vacancies.filter((v) => v.status === 'PendingApproval').length;
  // Still Open/PartiallyFilled (Vacancy.status is never mutated just
  // because a deadline lapsed - see scripts/checkVacancyDeadlines.js's own
  // comment) but past its deadline - candidates can no longer apply, so
  // this is specifically "needs your attention", not just "closed".
  const deadlinesPassed = vacancies.filter((v) =>
    v.deadline && new Date(v.deadline) < new Date() && (v.status === 'Open' || v.status === 'PartiallyFilled')
  ).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="home" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Alert type="error" message={error} />

          <GreetingHeader staff={staff} />

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

          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <StatusBreakdown vacancies={vacancies} loading={loadingVacancies} />
          </div>

          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
            <ClosingSoon vacancies={vacancies} loading={loadingVacancies} />
            <RecentVacancies vacancies={vacancies} loading={loadingVacancies} />
          </div>
        </div>
      </div>
    </div>
  );
}
