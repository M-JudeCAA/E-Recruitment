import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { LayoutDashboard, FileStack, IdCard, GraduationCap, Briefcase } from 'lucide-react';
import Sidebar from './Sidebar';
import DashboardTopBar from './DashboardTopBar';
import { useAuth } from '../models/AuthContext';

export default function CandidateDashboardLayout() {
  const { candidate, logoutCandidate } = useAuth();

  const items = [
    { to: '/dashboard', end: true, label: 'Home', icon: LayoutDashboard },
    { to: '/dashboard/applications', label: 'My applications', icon: FileStack },
    ...(candidate?.candidateType === 'Internal' ? [{ to: '/dashboard/profile', label: 'Internal profile', icon: IdCard }] : []),
    { to: '/dashboard/records', label: 'Experience & education', icon: GraduationCap }
  ];

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', background: 'var(--color-canvas)' }}>
      <Sidebar
        items={items}
        userLabel={candidate?.fullName}
        userSublabel={candidate?.candidateType ? `${candidate.candidateType} candidate` : undefined}
        onLogout={logoutCandidate}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <DashboardTopBar right={
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 500, color: 'var(--color-text-muted)', textDecoration: 'none' }}>
            <Briefcase size={15} /> Browse open vacancies
          </Link>
        } />
        <main style={{ flex: 1, width: '100%', padding: '28px 24px', boxSizing: 'border-box' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
