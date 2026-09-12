import React from "react";
import { Link } from "react-router-dom";
import { User, LogOut } from "lucide-react";
import { useAuth } from "../models/AuthContext";
import NotificationBell from "./NotificationBell";
import CandidateNotificationBell from "./CandidateNotificationBell";
import Avatar from "./Avatar";
import { candidateFileSrc } from "../utils/fileSrc";
import ucaaLogo from "../assets/ucaa-logo.png";

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
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "var(--navbar-height)",
        zIndex: 100,
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
          height: "100%",
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          gap: 20,
          boxSizing: "border-box",
        }}
      >
        {/* Real UCAA logo - the PNG's own background is opaque white, so it
            sits on a small white rounded card rather than directly on the
            navbar's blue gradient. Links to the HR home page for a
            signed-in staff member, the candidate dashboard for a
            signed-in candidate (the guest landing page's "Create an
            account"/"Sign in" CTAs don't make sense once already signed
            in), or the guest landing page otherwise. */}
        <Link
          to={staff ? "/hr/home" : candidate ? "/dashboard" : "/"}
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              flexShrink: 0,
              borderRadius: 8,
              background: "#FFFFFF",
              padding: 3,
              boxSizing: "border-box",
            }}
          >
            <img src={ucaaLogo} alt="UCAA logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
            <Link to="/dashboard" style={linkStyle}>
              My dashboard
            </Link>
            <CandidateNotificationBell />

            {/* Profile chip - same shape as staff's below (circular
                photo/icon + stacked name/type), just fed from the
                candidate's own photoUrl/fullName/candidateType, so a
                signed-in candidate and a signed-in staff member get a
                consistent navbar regardless of which side of the app
                they're on. */}
            {candidate.fullName && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar
                  src={candidateFileSrc(candidate.photoUrl)}
                  size={30}
                  background="rgba(255,255,255,0.15)"
                  border="1px solid rgba(255,255,255,0.4)"
                  iconColor="#FFFFFF"
                />
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
                  <span style={{ ...linkStyle, fontWeight: 600, fontSize: 13 }}>{candidate.fullName}</span>
                  {candidate.candidateType && (
                    <span style={{ ...linkStyle, fontWeight: 400, fontSize: 11, opacity: 0.8 }}>
                      {candidate.candidateType}
                    </span>
                  )}
                </span>
              </div>
            )}

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
        ) : null}
      </div>
    </nav>
  );
}
