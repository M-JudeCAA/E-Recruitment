import React from 'react';
import { Link } from 'react-router-dom';
import { Home, Briefcase, FileText } from 'lucide-react';

// Shared across every /dashboard/* screen, mirroring HRSidebar's pattern
// for the staff side of the app. Home is the default landing page after
// candidate login (see CandidateLogin.jsx's navigate("/dashboard")).
const ITEMS = [
  { key: 'home', label: 'Home', icon: Home, to: '/dashboard' },
  { key: 'jobs', label: 'Available Jobs', icon: Briefcase, to: '/dashboard/jobs' },
  { key: 'applications', label: 'Application', icon: FileText, to: '/dashboard/applications' },
];

export default function CandidateSidebar({ active }) {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--color-bg-subtle)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--spacing-sm)',
        position: 'sticky',
        top: 'var(--spacing-md)',
      }}
    >
      {ITEMS.map(({ key, label, icon: Icon, to }) => {
        const isActive = active === key;
        return (
          <Link
            key={key}
            to={to}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              boxSizing: 'border-box',
              textDecoration: 'none',
              padding: '10px 12px',
              marginBottom: 4,
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              background: isActive ? 'var(--color-primary)' : 'transparent',
              color: isActive ? '#FFFFFF' : 'var(--color-text)',
            }}
          >
            <Icon size={16} /> {label}
          </Link>
        );
      })}
    </aside>
  );
}
