import React, { useEffect, useState } from 'react';
import { Home, Briefcase, FileText, Building2, CalendarClock, Award, LayoutDashboard, ClipboardCheck, Users } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../models/AuthContext';
import staffClient from '../models/staffApiClient';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

// Manager/Director get a reimagined landing (Executive Overview, replacing
// the HR Officer's plainer Home) plus a dedicated Approvals Center that
// unifies every queue only they can clear - vacancy approvals, offer
// approvals, department approvals - instead of hunting across the
// operational tabs below for a PendingApproval badge. The badge count is
// fetched here (not passed down) so it shows up on every /hr/* screen a
// Manager/Director visits, not just the two new pages themselves.
export default function HRSidebar({ active }) {
  const { staff } = useAuth();
  const isExecutive = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager;
  // Staff Management (accounts + delegations, StaffManagement.jsx) is
  // Senior HR Officer+ - the lower of the two tiers its two sections used
  // to be gated at separately as standalone Navbar-linked pages. An HR
  // Officer has nothing to do there (can't create accounts, has nobody to
  // delegate to), so the item is hidden rather than shown and 403'd.
  const canManageTeam = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;
  const [pendingApprovals, setPendingApprovals] = useState(null);

  useEffect(() => {
    if (!isExecutive) return;
    staffClient.get('/api/dashboard/summary')
      .then((res) => {
        const s = res.data;
        setPendingApprovals((s.vacanciesByStatus?.PendingApproval || 0) + s.offersPendingApproval + s.pendingDepartments);
      })
      .catch(() => {}); // sidebar badge is a nice-to-have, never worth surfacing an error banner for
  }, [isExecutive]);

  // Vacancies/Applications/Interviews/Offer are tabs on the HR dashboard
  // itself (driven by /hr's ?tab= query param, read in HRDashboard.jsx),
  // not separate routes - Departments and Staff Management have their own
  // existing screens with their own routes, so they link out directly
  // instead of duplicating that here. Shared by every staff role that
  // qualifies - a Manager/Director still does everything an HR Officer
  // (and Senior/Principal HR Officer) does, on top of approving.
  const operationalItems = [
    { key: 'vacancies', label: 'Vacancy Management', icon: Briefcase, to: '/hr' },
    { key: 'applications', label: 'Application Management', icon: FileText, to: '/hr?tab=applications' },
    { key: 'departments', label: 'Department Management', icon: Building2, to: '/hr/departments' },
    ...(canManageTeam
      ? [{ key: 'staff-management', label: 'Staff Management', icon: Users, to: '/hr/staff-management' }]
      : []),
    { key: 'interviews', label: 'Interview Management', icon: CalendarClock, to: '/hr?tab=interviews' },
    { key: 'offers', label: 'Offer Management', icon: Award, to: '/hr?tab=offers' },
  ];

  const items = isExecutive
    ? [
        { key: 'executive', label: 'Executive Overview', icon: LayoutDashboard, to: '/hr/executive' },
        { key: 'approvals', label: 'Approvals Center', icon: ClipboardCheck, to: '/hr/approvals', badge: pendingApprovals },
        ...operationalItems,
      ]
    : [
        { key: 'home', label: 'Home', icon: Home, to: '/hr/home' },
        ...operationalItems,
      ];

  return <Sidebar items={items} active={active} storageKey="hrSidebarCollapsed" width={250} />;
}
