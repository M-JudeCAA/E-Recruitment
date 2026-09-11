import React from 'react';
import { Link } from 'react-router-dom';
import { Home, FileText } from 'lucide-react';

// Shared across every /dashboard/* screen, mirroring HRSidebar's pattern
// for the staff side of the app. Home is the default landing page after
// candidate login (see CandidateLogin.jsx's navigate("/dashboard")) and
// now also carries the Available Jobs search/listing directly - there's
// no separate jobs item/route any more, see CandidateHome.jsx.
const ITEMS = [
  { key: 'home', label: 'Home', icon: Home, to: '/dashboard' },
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
