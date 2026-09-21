import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardCheck, Briefcase, Users, TrendingUp, ArrowRight,
  CheckCircle2, RefreshCw, Award, Building2
} from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useDashboardEvents } from '../models/dashboardSocket';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Alert from '../components/Alert';
import LiveIndicator from '../components/LiveIndicator';
import FollowUpsPanel from '../components/FollowUpsPanel';
import Skeleton from '../components/Skeleton';
import StatusDonutChart from '../components/charts/StatusDonutChart';
import DirectorateBarChart from '../components/charts/DirectorateBarChart';
import TrendAreaChart from '../components/charts/TrendAreaChart';
import FunnelChart from '../components/charts/FunnelChart';
import { debounce } from '../utils/debounce';

function KpiCard({ icon: Icon, label, value, accent, loading, to }) {
  const navigate = useNavigate();
  return (
    <Card accent={accent} style={{ marginBottom: 0 }} onClick={to ? () => navigate(to) : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
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

function GreetingHeader({ staff, pendingCount, connected }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = staff?.name?.split(' ')[0] || 'there';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12,
      marginBottom: 'var(--spacing-lg)'
    }}>
      <div>
        <h2 style={{ margin: 0, color: 'var(--color-text)' }}>{greeting}, {firstName}</h2>
        {staff?.role && (
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
            {staff.role.replace(/_/g, ' ')} &middot; Executive Overview
          </p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <LiveIndicator connected={connected} />
        {pendingCount > 0 && (
          <Link to="/hr/approvals" style={{ textDecoration: 'none' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px',
              borderRadius: 999, background: 'var(--color-danger)', color: '#fff', fontSize: 13, fontWeight: 600
            }}>
              <ClipboardCheck size={15} />
              {pendingCount} awaiting your approval
              <ArrowRight size={14} />
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

const ACTIVITY_ICON = {
  VacancyApproved: CheckCircle2,
  PostingTypeTransition: RefreshCw,
  OfferApproved: Award,
  DepartmentApproved: Building2,
};

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ActivityFeed({ items, loading }) {
  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Recent approval activity
      </div>
      {loading ? (
        <div>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
              <Skeleton width={28} height={28} radius="50%" style={{ flexShrink: 0 }} />
              <Skeleton width={`${60 - i * 8}%`} height={13} />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No approvals recorded yet.</p>
      ) : (
        <div className="panel-scroll">
          {items.map((item, i) => {
            const Icon = ACTIVITY_ICON[item.type] || CheckCircle2;
            return (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0',
                borderTop: i > 0 ? '1px solid var(--color-border)' : 'none'
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', background: 'var(--color-bg-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2
                }}>
                  <Icon size={14} color="var(--color-primary)" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{item.actor || 'Someone'}</strong> {item.text}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{timeAgo(item.at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

const VACANCY_STATUS_ORDER = ['PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed'];
const APPLICATION_STATUS_ORDER = ['Submitted', 'Shortlisted', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn'];

// Reimagined Manager/Director landing page (replaces HRHome for this
// tier - see HRSidebar.jsx, Navbar.jsx, StaffLogin.jsx for the role-based
// redirect). Where HRHome is an HR Officer's operational worklist, this is
// an oversight view: org-wide pipeline health, headcount, and a prompt
// toward the Approvals Center rather than a vacancy-creation form.
export default function ExecutiveDashboard() {
  const { staff } = useAuth();
  const [summary, setSummary] = useState(null);
  const [headcount, setHeadcount] = useState([]);
  const [activity, setActivity] = useState([]);
  const [trends, setTrends] = useState(null);
  const [trendDays, setTrendDays] = useState(30);
  const [followUps, setFollowUps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingTrends, setLoadingTrends] = useState(true);
  const [loadingFollowUps, setLoadingFollowUps] = useState(true);
  const [error, setError] = useState('');

  const loadCore = useCallback(() => {
    Promise.all([
      staffClient.get('/api/dashboard/summary'),
      staffClient.get('/api/dashboard/headcount-by-directorate'),
      staffClient.get('/api/dashboard/activity'),
    ])
      .then(([summaryRes, headcountRes, activityRes]) => {
        setSummary(summaryRes.data);
        setHeadcount(headcountRes.data);
        setActivity(activityRes.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load the executive dashboard'))
      .finally(() => setLoading(false));
  }, []);
  const loadFollowUps = useCallback(() => {
    staffClient.get('/api/dashboard/follow-ups')
      .then((res) => setFollowUps(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load follow-ups'))
      .finally(() => setLoadingFollowUps(false));
  }, []);
  const loadTrends = useCallback((days) => {
    setLoadingTrends(true);
    staffClient.get('/api/dashboard/trends', { params: { days } })
      .then((res) => setTrends(res.data))
      .catch(() => {}) // trend chart is a nice-to-have, never worth an error banner
      .finally(() => setLoadingTrends(false));
  }, []);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => { loadFollowUps(); }, [loadFollowUps]);
  useEffect(() => { loadTrends(trendDays); }, [loadTrends, trendDays]);

  // Same "refetch everything, debounced" approach as HRHome - a Manager's
  // landing page cares about all seven broadcast event types, so there's
  // no meaningful subset to narrow to.
  const refetchAll = useCallback(debounce(() => {
    loadCore(); loadFollowUps(); loadTrends(trendDays);
  }, 500), [loadCore, loadFollowUps, loadTrends, trendDays]);
  const { connected } = useDashboardEvents(refetchAll);

  const vacanciesByStatus = summary?.vacanciesByStatus || {};
  const applicationsByStatus = summary?.applicationsByStatus || {};
  const offersByStatus = summary?.offersByStatus || {};
  const pendingCount = summary
    ? (vacanciesByStatus.PendingApproval || 0) + (summary.offersPendingApproval || 0) + (summary.pendingDepartments || 0)
    : 0;
  const openPositions = (vacanciesByStatus.Open || 0) + (vacanciesByStatus.PartiallyFilled || 0);
  const inPipeline = APPLICATION_STATUS_ORDER
    .filter((s) => !['Rejected', 'Withdrawn'].includes(s))
    .reduce((sum, s) => sum + (applicationsByStatus[s] || 0), 0);
  const funnelCounts = {
    Submitted: applicationsByStatus.Submitted || 0,
    Shortlisted: applicationsByStatus.Shortlisted || 0,
    Interviewed: applicationsByStatus.Interviewed || 0,
    Offered: applicationsByStatus.Offered || 0,
    Accepted: offersByStatus.Accepted || 0
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="executive" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Alert type="error" message={error} />

          <GreetingHeader staff={staff} pendingCount={pendingCount} connected={connected} />

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)'
          }}>
            <KpiCard icon={ClipboardCheck} label="Awaiting your approval" value={pendingCount}
              accent="var(--color-danger)" loading={loading} to="/hr/approvals" />
            <KpiCard icon={Briefcase} label="Open positions" value={openPositions}
              accent="var(--color-primary)" loading={loading} />
            <KpiCard icon={TrendingUp} label="Applications in pipeline" value={inPipeline}
              accent="var(--color-accent)" loading={loading} />
            <KpiCard icon={Users} label="Filled this cycle" value={vacanciesByStatus.Filled || 0}
              accent="var(--color-warning)" loading={loading} />
          </div>

          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <TrendAreaChart data={trends} loading={loadingTrends} days={trendDays} onDaysChange={setTrendDays} />
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)'
          }}>
            <StatusDonutChart title="Vacancy pipeline" counts={vacanciesByStatus}
              order={VACANCY_STATUS_ORDER} loading={loading} emptyText="No vacancies yet." />
            <StatusDonutChart title="Application pipeline" counts={applicationsByStatus}
              order={APPLICATION_STATUS_ORDER} loading={loading} emptyText="No applications yet." />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
            <FunnelChart counts={funnelCounts} loading={loading} />
            <DirectorateBarChart rows={headcount} loading={loading} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--spacing-md)' }}>
            <FollowUpsPanel items={followUps} loading={loadingFollowUps} actionable emptyText="Nothing waiting on the team right now." />
            <ActivityFeed items={activity} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
