import React from 'react';
import { Outlet } from 'react-router-dom';
import { LayoutDashboard, Briefcase, Building2, Users, GitBranch } from 'lucide-react';
import Sidebar from './Sidebar';
import DashboardTopBar from './DashboardTopBar';
import NotificationBell from './NotificationBell';
import { useAuth } from '../models/AuthContext';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function StaffDashboardLayout() {
  const { staff, logoutStaff } = useAuth();
  const canManageStaff = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;
  const canDelegate = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;

  const items = [
    { to: '/hr', end: true, label: 'Home', icon: LayoutDashboard },
    { to: '/hr/vacancies', label: 'Vacancies', icon: Briefcase },
    { to: '/hr/departments', label: 'Departments', icon: Building2 },
    ...(canManageStaff ? [{ to: '/hr/staff', label: 'Staff accounts', icon: Users }] : []),
    ...(canDelegate ? [{ to: '/hr/delegations', label: 'Delegations', icon: GitBranch }] : [])
  ];

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', background: 'var(--color-canvas)' }}>
      <Sidebar
        items={items}
        userLabel={staff?.name}
        userSublabel={staff?.role?.replace(/_/g, ' ')}
        onLogout={logoutStaff}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <DashboardTopBar right={<NotificationBell />} />
        <main style={{ flex: 1, width: '100%', padding: '28px 24px', boxSizing: 'border-box' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
