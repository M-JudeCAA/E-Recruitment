import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../models/AuthContext";
import NotificationBell from "./NotificationBell";
import CandidateNotificationBell from "./CandidateNotificationBell";
import ProfileMenu from "./ProfileMenu";
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

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function Navbar() {
  const { candidate, staff, logoutCandidate, logoutStaff } = useAuth();
  // Manager/Director land on the reimagined Executive Overview instead of
  // the HR Officer's operational Home - see HRSidebar.jsx/ExecutiveDashboard.jsx.
  const isExecutive = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager;

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
          to={staff ? (isExecutive ? "/hr/executive" : "/hr/home") : candidate ? "/dashboard" : "/"}
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

            {/* Account panel - click the avatar for a card with name/type/
                email and Sign out, replacing the old always-visible chip +
                separate logout button. Same shape as staff's below so a
                signed-in candidate and a signed-in staff member get a
                consistent navbar regardless of which side of the app
                they're on. */}
            <ProfileMenu
              name={candidate.fullName}
              subtitle={candidate.candidateType}
              email={candidate.email}
              avatarSrc={candidateFileSrc(candidate.photoUrl)}
              onLogout={logoutCandidate}
            />
          </>
        )}
        {staff ? (
          <>
            {/* Staff accounts / Delegations moved off the top nav - both
                now live under the "Staff Management" sidebar entry
                (HRSidebar.jsx) on one combined page (StaffManagement.jsx). */}
            <NotificationBell />

            {/* Account panel - carries "logged in as <name> (<role>)" plus
                email, moved here from the HR dashboard's page header so
                it's visible on every staff screen, not just that one.
                Click the avatar for the card; replaces the old
                always-visible chip + separate "Staff log out" button. */}
            <ProfileMenu
              name={staff?.name}
              subtitle={staff?.role?.replace(/_/g, ' ')}
              email={staff?.email}
              onLogout={logoutStaff}
            />
          </>
        ) : null}
      </div>
    </nav>
  );
}
