import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../models/AuthContext";
import NotificationBell from "./NotificationBell";

// Uganda Civil Aviation Authority brand palette
const ucaa = {
  navy: "#204D74", // Bay of Many
  blue: "#0C7ABF", // Denim
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
      <div
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <Link to="/" style={{ ...linkStyle, fontWeight: 600, fontSize: 16 }}>
          UCAA e-Recruitment
        </Link>
        <span style={{ flex: 1 }} />
        {candidate ? (
          <>
            <Link to="/dashboard" style={linkStyle}>
              My dashboard
            </Link>
            <button onClick={logoutCandidate} style={buttonStyle}>
              Log out
            </button>
          </>
        ) : (
          <Link to="/login" style={linkStyle}>
            Candidate login
          </Link>
        )}
        {staff ? (
          <>
            <Link to="/hr" style={linkStyle}>
              HR dashboard
            </Link>
            <Link to="/hr/departments" style={linkStyle}>
              Departments & positions
            </Link>
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
            <button onClick={logoutStaff} style={buttonStyle}>
              Staff log out
            </button>
          </>
        ) : (
          <Link to="/staff/login" style={linkStyle}>
            Staff login
          </Link>
        )}
      </div>
    </nav>
  );
}
