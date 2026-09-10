import React from "react";
import { Link, NavLink } from "react-router-dom";
import { Plane, Briefcase, LogOut, Building2, Users, GitBranch } from "lucide-react";
import { useAuth } from "../models/AuthContext";
import NotificationBell from "./NotificationBell";

// CHANGED - the previous navbar was a full-bleed navy->blue gradient
// banner. Reimagined as a clean, light, sticky header: brand color now
// lives in the logo mark and active/hover states only, instead of
// painting the whole bar - reads as modern/minimal rather than "loud",
// while staying unmistakably on-brand (same --color-primary throughout).
const navLinkStyle = ({ isActive }) => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 500,
  padding: "7px 12px",
  borderRadius: "var(--radius-sm)",
  color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
  background: isActive ? "var(--color-primary-tint)" : "transparent",
  transition: "background var(--transition), color var(--transition)",
});

const buttonStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-sm)",
  padding: "7px 12px",
  fontSize: 13.5,
  fontWeight: 500,
  cursor: "pointer",
};

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK. Delegation
// is self-service (you delegate your own authority to a subordinate) -
// an HR Officer has nobody below them, so the link is hidden rather
// than shown and immediately 403'd.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function Navbar() {
  const { candidate, staff, logoutCandidate, logoutStaff } = useAuth();
  const canDelegate = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;
  const canManageStaff = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  return (
    <nav
      style={{
        width: "100%",
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border-subtle)",
        boxSizing: "border-box",
        position: "sticky",
        top: 0,
        zIndex: 30,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", marginRight: 16 }}>
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: 8, background: "var(--color-primary)", color: "#fff", flexShrink: 0
          }}>
            <Plane size={17} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text)", letterSpacing: -0.2 }}>
            UCAA e-Recruitment
          </span>
        </Link>
        <span style={{ flex: 1 }} />
        {candidate ? (
          <>
            {candidate.fullName && (
              <span style={{ fontSize: 13.5, color: "var(--color-text-muted)", marginRight: 4 }}>{candidate.fullName}</span>
            )}
            <NavLink to="/" style={navLinkStyle}>
              <Briefcase size={15} /> Available jobs
            </NavLink>
            <NavLink to="/dashboard" style={navLinkStyle}>
              My dashboard
            </NavLink>
            <button onClick={logoutCandidate} style={{ ...buttonStyle, marginLeft: 8 }}>
              <LogOut size={14} /> Log out
            </button>
          </>
        ) : (
          <Link to="/login" style={{ ...navLinkStyle({ isActive: false }) }}>
            Candidate login
          </Link>
        )}
        {staff ? (
          <>
            <NavLink to="/hr" end style={navLinkStyle}>
              HR dashboard
            </NavLink>
            <NavLink to="/hr/departments" style={navLinkStyle}>
              <Building2 size={15} /> Departments
            </NavLink>
            {canManageStaff && (
              <NavLink to="/hr/staff" style={navLinkStyle}>
                <Users size={15} /> Staff
              </NavLink>
            )}
            {canDelegate && (
              <NavLink to="/hr/delegations" style={navLinkStyle}>
                <GitBranch size={15} /> Delegations
              </NavLink>
            )}
            <NotificationBell />
            <button onClick={logoutStaff} style={{ ...buttonStyle, marginLeft: 8 }}>
              <LogOut size={14} /> Staff log out
            </button>
          </>
        ) : (
          // A logged-in candidate has already declared which side of the
          // app this session is for - staff sign-in is irrelevant to them,
          // not just unavailable. Shown only to a genuinely anonymous
          // visitor, who might be either kind of user.
          !candidate && (
            <Link to="/staff/login" style={navLinkStyle({ isActive: false })}>
              Staff login
            </Link>
          )
        )}
      </div>
    </nav>
  );
}
