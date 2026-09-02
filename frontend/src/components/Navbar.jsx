import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../models/AuthContext';

export default function Navbar() {
  const { candidate, staff, logoutCandidate, logoutStaff } = useAuth();

  return (
    <nav style={{ display: 'flex', gap: 16, marginBottom: 24, borderBottom: '1px solid #ddd', paddingBottom: 12 }}>
      <Link to="/">UCAA e-Recruitment</Link>
      <span style={{ flex: 1 }} />
      {candidate ? (
        <>
          <Link to="/dashboard">My dashboard</Link>
          <button onClick={logoutCandidate}>Log out</button>
        </>
      ) : (
        <Link to="/login">Candidate login</Link>
      )}
      {staff ? (
        <>
          <Link to="/hr">HR dashboard</Link>
          <button onClick={logoutStaff}>Staff log out</button>
        </>
      ) : (
        <Link to="/staff/login">Staff login</Link>
      )}
    </nav>
  );
}
