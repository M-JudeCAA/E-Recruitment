import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Briefcase, ChevronDown } from "lucide-react";
import { useAuth } from "../models/AuthContext";
import client from "../models/apiClient";
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

  // NEW - adapted from the wizard prototype's Navbar. Folded into this
  // existing, single global Navbar rather than kept as a separate
  // component, which would have stacked a redundant second navbar on
  // every apply page.
  const [jobsOpen, setJobsOpen] = useState(false);
  const [openJobs, setOpenJobs] = useState([]);
  useEffect(() => {
    if (candidate) {
      client.get('/api/vacancies').then((res) => setOpenJobs(res.data)).catch(() => {});
    }
  }, [candidate]);

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
            {candidate.fullName && (
              <span style={{ ...linkStyle, fontWeight: 400, opacity: 0.85 }}>{candidate.fullName}</span>
            )}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setJobsOpen((v) => !v)} style={{ ...linkStyle, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer' }}>
                <Briefcase size={14} /> Available jobs <ChevronDown size={13} style={{ opacity: 0.7 }} />
              </button>
              {jobsOpen && (
                <div style={{
                  position: 'absolute', right: 0, marginTop: 8, width: 300,
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(8,70,111,0.18)', zIndex: 10
                }}>
                  {openJobs.length === 0 && (
                    <div style={{ padding: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>No open vacancies right now.</div>
                  )}
                  {openJobs.map((job) => (
                    <Link key={job.id} to={`/apply/${job.id}`} onClick={() => setJobsOpen(false)}
                      style={{ display: 'block', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', textDecoration: 'none' }}>
                      <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text)', fontWeight: 500 }}>{job.title}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)' }}>{job.jobRef}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
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
