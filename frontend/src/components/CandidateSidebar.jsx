import React from 'react';
import { Link } from 'react-router-dom';
import { Home, Search, FileText, User } from 'lucide-react';

// Shared across every /dashboard/* screen, mirroring HRSidebar's pattern
// for the staff side of the app. Four stops instead of the previous two:
// Home is now a real overview (stats + shortcuts) rather than also
// carrying the full job listing, so browsing/searching vacancies gets its
// own "Find Jobs" stop (CandidateJobs.jsx) and profile editing gets its
// own "My Profile" stop (CandidateProfile.jsx, moved off the top of the
// Applications page so that page can focus on tracking applications).
const ITEMS = [
  { key: 'home', label: 'Home', icon: Home, to: '/dashboard' },
  { key: 'jobs', label: 'Find Jobs', icon: Search, to: '/dashboard/jobs' },
  { key: 'applications', label: 'My Applications', icon: FileText, to: '/dashboard/applications' },
  { key: 'profile', label: 'My Profile', icon: User, to: '/dashboard/profile' },
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
        boxSizing: 'border-box',
        // Sticky, not a real position:fixed - it stays pinned in the
        // viewport as the page scrolls (reads as "fixed" to a user) while
        // still reserving its own width as a normal flex item, so every
        // page that renders it needs no matching margin/left-offset hack.
        // top clears the fixed Navbar (App.jsx's --navbar-height) with a
        // little breathing room; maxHeight stops short of the fixed
        // Footer and switches to its own scrollbar once the item list
        // outgrows the space between them, instead of the sidebar
        // growing taller than the viewport or sliding under the footer.
        position: 'sticky',
        top: 'calc(var(--navbar-height) + var(--spacing-md))',
        maxHeight: 'calc(100vh - var(--navbar-height) - var(--footer-height) - var(--spacing-lg))',
        overflowY: 'auto',
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
