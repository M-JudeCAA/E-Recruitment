import React from "react";
import { Link, NavLink } from "react-router-dom";
import { Plane, LogOut, LayoutDashboard } from "lucide-react";
import { useAuth } from "../models/AuthContext";

// Top-of-site chrome for the public jobs board and auth flows only. Once
// signed in, /hr and /dashboard are separate full-height sidebar shells
// (see StaffDashboardLayout/CandidateDashboardLayout) that don't render
// this at all - so this only ever needs a single "go to my dashboard"
// link per audience, not the full set of dashboard sub-links it used to
// carry before the sidebar existed.
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

export default function Navbar() {
  const { candidate, staff, logoutCandidate, logoutStaff } = useAuth();

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
            <NavLink to="/dashboard" style={navLinkStyle}>
              <LayoutDashboard size={15} /> My dashboard
            </NavLink>
            <button onClick={logoutCandidate} style={{ ...buttonStyle, marginLeft: 8 }}>
              <LogOut size={14} /> Log out
            </button>
          </>
        ) : (
          <Link to="/login" style={navLinkStyle({ isActive: false })}>
            Candidate login
          </Link>
        )}
        {staff ? (
          <>
            <NavLink to="/hr" style={navLinkStyle}>
              <LayoutDashboard size={15} /> HR dashboard
            </NavLink>
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
