import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../models/AuthContext';
import { isStaffPort } from '../staffPort';

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

// Guards the unauthenticated staff entry points (login, forgot/reset
// password) so they only render from the staff-only port - reached
// directly by URL on the guest port otherwise, since removing the navbar
// link (Navbar.jsx) only hides the link, not the route itself.
export function RequireStaffPort({ children }) {
  if (!isStaffPort()) return <Navigate to="/" replace />;
  return children;
}

// Mirror image of RequireStaffPort: gates every guest/candidate-facing
// route (the landing page, register, candidate login, the dashboard,
// apply, etc.) so none of them render from the staff-only port - a staff
// member opening that port directly always lands on staff login instead,
// no matter which guest URL they typed or had bookmarked. A layout route
// (like PaddedLayout below), so App.jsx wraps a whole group of routes in
// it at once rather than repeating this on every single one.
export function GuestPortGate() {
  if (isStaffPort()) return <Navigate to="/staff/login" replace />;
  return <Outlet />;
}

export function RequireStaff({ minRole = 'HR_Officer', children }) {
  const { staff } = useAuth();
  if (!staff) return <Navigate to="/staff/login" replace />;
  if ((ROLE_RANK[staff.role] || 0) < (ROLE_RANK[minRole] || 0)) {
    // Browser history is a per-tab stack of URLs, not per-account - it has
    // no idea a different, higher-privileged account was signed in when a
    // page like this was last visited. Back (or a stale bookmark, or a
    // link shared by someone with more access) can land the CURRENT
    // account on a URL it no longer has permission for. A bare dead-end
    // message here used to be the result; sending them to wherever they
    // actually belong instead - same landing logic StaffLogin.jsx uses
    // right after a fresh login - is far more useful and matches how the
    // "not authenticated at all" branch above already behaves.
    const isExecutive = (ROLE_RANK[staff.role] || 0) >= ROLE_RANK.Manager;
    return <Navigate to={isExecutive ? '/hr/executive' : '/hr/home'} replace />;
  }
  return children;
}

export function RequireCandidate({ children }) {
  const { candidate } = useAuth();
  const location = useLocation();
  if (!candidate) {
    // Remembers the page the candidate was trying to reach (an Advert
    // User clicking Apply while logged out, most importantly) so login/
    // register can send them back afterward instead of stranding them on
    // a generic dashboard. See CandidateLogin.jsx/Register.jsx.
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return children;
}
