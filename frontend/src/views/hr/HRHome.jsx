import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, CheckCircle2, Clock, FileStack, Bell, ArrowRight, CircleCheck, Building2 } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import { useAuth } from '../../models/AuthContext';
import useNotifications from '../../hooks/useNotifications';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import StatusBadge from '../../components/StatusBadge';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function HRHome() {
  const { staff } = useAuth();
  const canApprove = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager;
  const isReviewer = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  const [vacancies, setVacancies] = useState([]);
  const [pendingDepartments, setPendingDepartments] = useState([]);
  const { notifications, error: notifError, markRead } = useNotifications();

  useEffect(() => {
    staffClient.get('/api/vacancies/admin').then((res) => setVacancies(res.data));
    if (isReviewer) {
      staffClient.get('/api/departments/pending').then((res) => setPendingDepartments(res.data)).catch(() => {});
    }
  }, [isReviewer]);

  const openCount = vacancies.filter((v) => v.status === 'Open' || v.status === 'PartiallyFilled').length;
  const vacanciesPendingApproval = vacancies.filter((v) => v.status === 'PendingApproval');
  const applicationCount = vacancies.reduce((sum, v) => sum + (v._count?.applications ?? 0), 0);
  // /api/vacancies/admin is already ordered createdAt desc server-side.
  const recentVacancies = vacancies.slice(0, 5);

  const attentionItems = [
    ...(canApprove ? vacanciesPendingApproval.map((v) => ({
      key: `vac-${v.id}`, text: `${v.title} (${v.jobRef}) needs approval`, to: '/hr/vacancies'
    })) : []),
    ...(isReviewer ? pendingDepartments.map((d) => ({
      key: `dept-${d.id}`, text: `${d.directorate.name} — ${d.name} department needs approval`, to: '/hr/departments'
    })) : [])
  ];

  return (
    <div>
      <PageHeader
        eyebrow="HR"
        title={`Welcome back, ${staff?.name?.split(' ')[0] || 'there'}`}
        subtitle={`${staff?.role?.replace(/_/g, ' ')} · here's what's happening across recruitment`}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <StatTile icon={Briefcase} label="Total vacancies" value={vacancies.length} />
        <StatTile icon={CheckCircle2} label="Open" value={openCount} color="var(--color-accent)" tint="var(--color-accent-tint)" />
        <StatTile icon={Clock} label="Pending approval" value={vacanciesPendingApproval.length} color="var(--color-warning)" tint="var(--color-warning-tint)" />
        <StatTile icon={FileStack} label="Applications received" value={applicationCount} />
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          <Card>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={17} style={{ color: 'var(--color-warning)' }} /> Needs your attention
            </h3>
            {attentionItems.length === 0 && (
              <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CircleCheck size={15} style={{ color: 'var(--color-accent)' }} /> You're all caught up.
              </p>
            )}
            {attentionItems.map((item) => (
              <Link key={item.key} to={item.to} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)',
                textDecoration: 'none', color: 'var(--color-text)', fontSize: 13.5
              }}>
                {item.text}
                <ArrowRight size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              </Link>
            ))}
          </Card>

          <Card>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Briefcase size={17} style={{ color: 'var(--color-primary)' }} /> Recent vacancies
            </h3>
            {recentVacancies.length === 0 && (
              <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>No vacancies created yet.</p>
            )}
            {recentVacancies.map((v) => (
              <Link key={v.id} to={v.status === 'PendingApproval' ? '/hr/vacancies' : `/hr/vacancy/${v.id}`} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', textDecoration: 'none'
              }}>
                <span style={{ fontSize: 13.5, color: 'var(--color-text)' }}>
                  {v.title} <span style={{ color: 'var(--color-text-muted)' }}>· {v.department?.name}</span>
                </span>
                <StatusBadge status={v.status} />
              </Link>
            ))}
            {recentVacancies.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <Link to="/hr/vacancies" style={{ fontSize: 13, fontWeight: 500 }}>View all vacancies</Link>
              </div>
            )}
          </Card>
        </div>

        <div style={{ flex: '1 1 280px', minWidth: 280 }}>
          <Card>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={16} style={{ color: 'var(--color-primary)' }} /> Notifications
            </h3>
            {notifError && <p style={{ fontSize: 13, color: 'var(--color-danger)' }}>{notifError}</p>}
            {notifications.length === 0 && !notifError && (
              <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>No unread notifications.</p>
            )}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {notifications.map((n) => (
                <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <div style={{ fontSize: 13 }}>{n.message}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{new Date(n.sentAt).toLocaleString()}</span>
                    <button onClick={() => markRead(n.id)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer' }}>
                      Mark read
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {isReviewer && (
            <Card>
              <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={16} style={{ color: 'var(--color-primary)' }} /> Org structure
              </h3>
              <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>
                {pendingDepartments.length} department{pendingDepartments.length === 1 ? '' : 's'} awaiting your approval.
              </p>
              <Link to="/hr/departments" style={{ fontSize: 13, fontWeight: 500 }}>Manage departments</Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
