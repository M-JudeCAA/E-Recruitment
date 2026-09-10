import React from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, FileText, Building2, CalendarClock, Award } from 'lucide-react';

// Shared across every /hr/* screen so the navigation is identical no matter
// which one you're on. Vacancies/Applications/Interviews/Offer are tabs on
// the HR dashboard itself (driven by /hr's ?tab= query param, read in
// HRDashboard.jsx), not separate routes - Departments is its own existing
// screen (DepartmentAdmin) with its own create/approve workflow, so it
// links out to /hr/departments instead of duplicating that here.
const ITEMS = [
  { key: 'vacancies', label: 'Vacancy Management', icon: Briefcase, to: '/hr' },
  { key: 'applications', label: 'Application Management', icon: FileText, to: '/hr?tab=applications' },
  { key: 'departments', label: 'Department Management', icon: Building2, to: '/hr/departments' },
  { key: 'interviews', label: 'Interview Management', icon: CalendarClock, to: '/hr?tab=interviews' },
  // "Job" dropped to match the single-noun + "Management" pattern of the
  // other four, and to keep it from wrapping in the 220px-wide sidebar.
  { key: 'offers', label: 'Offer Management', icon: Award, to: '/hr?tab=offers' },
];

export default function HRSidebar({ active }) {
  return (
    <aside
      style={{
        width: 250,
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
