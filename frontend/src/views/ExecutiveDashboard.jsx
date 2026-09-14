import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardCheck, Briefcase, Users, TrendingUp, ArrowRight,
  CheckCircle2, RefreshCw, Award, Building2
} from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Alert from '../components/Alert';
import { STATUS_COLORS } from '../components/StatusBadge';

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

function GreetingHeader({ staff, pendingCount }) {
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
  );
}

// Reusable proportional bar + legend, keyed off StatusBadge's own
// STATUS_COLORS so a status reads the same color here as everywhere else
// in the app. Generic over any {label: count} map, unlike HRHome's
// vacancy-only version, since this page reuses the same shape for both
// vacancy and application pipelines.
function ProportionalBreakdown({ title, counts, order, loading, emptyText }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const present = order.filter((k) => counts[k] > 0);
  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>{title}</div>
      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : total === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{emptyText}</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--color-bg-subtle)' }}>
            {present.map((k) => (
              <div key={k} title={`${k.replace(/_/g, ' ')}: ${counts[k]}`}
                style={{ width: `${(counts[k] / total) * 100}%`, background: STATUS_COLORS[k] || 'var(--color-text-muted)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
            {present.map((k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[k] || 'var(--color-text-muted)', flexShrink: 0 }} />
                {k.replace(/_/g, ' ')} ({counts[k]})
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// Stacked horizontal bars, one per directorate, Open/PartiallyFilled/
// Filled segments sized against that directorate's own total - answers
// "where is headcount concentrated, and how much of it is actually
// filled" at a glance, which nothing before this page surfaced at all.
function HeadcountByDirectorate({ rows, loading }) {
  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Headcount by directorate
      </div>
      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No active vacancies yet.</p>
      ) : (
        rows.slice(0, 6).map((r) => (
          <div key={r.directorate} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{r.directorate}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{r.Filled}/{r.totalPositions} filled</span>
            </div>
            <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--color-bg-subtle)' }}>
              {r.Filled > 0 && <div style={{ width: `${(r.Filled / r.totalPositions) * 100}%`, background: STATUS_COLORS.Filled }} title={`Filled: ${r.Filled}`} />}
              {r.PartiallyFilled > 0 && <div style={{ width: `${(r.PartiallyFilled / r.totalPositions) * 100}%`, background: STATUS_COLORS.PartiallyFilled }} title={`Partially filled: ${r.PartiallyFilled}`} />}
              {r.Open > 0 && <div style={{ width: `${(r.Open / r.totalPositions) * 100}%`, background: STATUS_COLORS.Open }} title={`Open: ${r.Open}`} />}
            </div>
          </div>
        ))
      )}
    </Card>
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
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No approvals recorded yet.</p>
      ) : (
        items.map((item, i) => {
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
        })
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
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

  const vacanciesByStatus = summary?.vacanciesByStatus || {};
  const applicationsByStatus = summary?.applicationsByStatus || {};
  const pendingCount = summary
    ? (vacanciesByStatus.PendingApproval || 0) + (summary.offersPendingApproval || 0) + (summary.pendingDepartments || 0)
    : 0;
  const openPositions = (vacanciesByStatus.Open || 0) + (vacanciesByStatus.PartiallyFilled || 0);
  const inPipeline = APPLICATION_STATUS_ORDER
    .filter((s) => !['Rejected', 'Withdrawn'].includes(s))
    .reduce((sum, s) => sum + (applicationsByStatus[s] || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="executive" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Alert type="error" message={error} />

          <GreetingHeader staff={staff} pendingCount={pendingCount} />

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

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)'
          }}>
            <ProportionalBreakdown title="Vacancy pipeline" counts={vacanciesByStatus}
              order={VACANCY_STATUS_ORDER} loading={loading} emptyText="No vacancies yet." />
            <ProportionalBreakdown title="Application pipeline" counts={applicationsByStatus}
              order={APPLICATION_STATUS_ORDER} loading={loading} emptyText="No applications yet." />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--spacing-md)' }}>
            <HeadcountByDirectorate rows={headcount} loading={loading} />
            <ActivityFeed items={activity} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
