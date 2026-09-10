import React from "react";
import { Link } from "react-router-dom";
import { Briefcase, Plane, User, LogOut } from "lucide-react";
import { useAuth } from "../models/AuthContext";
import NotificationBell from "./NotificationBell";

// CHANGED - was a separate, hardcoded palette disconnected from
// theme.css (and from CandidateLogin.jsx's own separate hardcoded
// palette). Both now read the same shared CSS variables, closing a real
// visual-drift gap found while adopting the new design direction.
const ucaa = {
  navy: "var(--color-primary-dark)",
  blue: "var(--color-primary)",
  line: "rgba(255,255,255,0.15)",
};

const linkStyle = {
  color: "#FFFFFF",
  textDecoration: "none",
  fontSize: 14.5,
  fontWeight: 500,
};

const buttonStyle = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.4)",
  color: "#FFFFFF",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 13.5,
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
        background: `linear-gradient(90deg, ${ucaa.navy} 0%, ${ucaa.blue} 100%)`,
        borderBottom: `1px solid ${ucaa.line}`,
        boxSizing: "border-box",
      }}
    >
      {/* No maxWidth/centering here - matches PaddedLayout's flat 20px
          inset (App.jsx) exactly, so the logo's left edge and the profile
          chip's right edge line up with the page content below instead of
          drifting apart on wide viewports where a centered, width-capped
          bar would leave extra margin the page content doesn't have. */}
      <div
        style={{
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        {/* Logo placeholder - a real UCAA logo asset can be dropped in and
            swapped for this SVG mark; the wordmark/link behavior stays the
            same either way. Links to the HR dashboard for a signed-in staff
            member (their landing page after login), or home otherwise. */}
        <Link
          to={staff ? "/hr" : "/"}
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.4)",
            }}
          >
            <Plane size={18} color="#FFFFFF" style={{ transform: "rotate(45deg)" }} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ ...linkStyle, fontWeight: 700, fontSize: 14.5 }}>
              Uganda Civil Aviation Authority
            </span>
            <span style={{ ...linkStyle, fontWeight: 400, fontSize: 11.5, opacity: 0.85 }}>
              e-Recruitment
            </span>
          </span>
        </Link>
        <span style={{ flex: 1 }} />
        {candidate && (
          <>
            {candidate.fullName && (
              <span style={{ ...linkStyle, fontWeight: 400, opacity: 0.85 }}>{candidate.fullName}</span>
            )}
            <Link to="/" style={{ ...linkStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Briefcase size={14} /> Available jobs
            </Link>
            <Link to="/dashboard" style={linkStyle}>
              My dashboard
            </Link>
            <button onClick={logoutCandidate} style={{ ...buttonStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={14} /> Log out
            </button>
          </>
        )}
        {staff ? (
          <>
            {canManageStaff && (
              <Link to="/hr/staff" style={linkStyle}>
                Staff accounts
              </Link>
            )}
            {canDelegate && (
              <Link to="/hr/delegations" style={linkStyle}>
                Delegations
              </Link>
            )}
            <NotificationBell />

            {/* Profile chip - carries "logged in as <name> (<role>)", moved
                here from the HR dashboard's page header so it's visible on
                every staff screen, not just that one. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                  border: "1px solid rgba(255,255,255,0.4)",
                }}
              >
                <User size={15} color="#FFFFFF" />
              </span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
                <span style={{ ...linkStyle, fontWeight: 600, fontSize: 13 }}>{staff?.name}</span>
                <span style={{ ...linkStyle, fontWeight: 400, fontSize: 11, opacity: 0.8 }}>
                  {staff?.role?.replace(/_/g, ' ')}
                </span>
              </span>
            </div>

            <button onClick={logoutStaff} style={{ ...buttonStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={14} /> Staff log out
            </button>
          </>
        ) : (
          // A logged-in candidate has already declared which side of the
          // app this session is for - staff sign-in is irrelevant to them,
          // not just unavailable. Shown only to a genuinely anonymous
          // visitor, who might be either kind of user.
          !candidate && (
            <Link to="/staff/login" style={linkStyle}>
              Staff login
            </Link>
          )
        )}
      </div>
    </nav>
  );
}
