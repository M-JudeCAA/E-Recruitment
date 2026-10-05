import React from 'react';

// `actions` (optional) sit at the right of the title - the one place a page's
// main buttons go. The page-title/page-subtitle classes let the staff
// workspace (theme.css .staff-ui) give every staff page the same title style.
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title" style={{ margin: 0, color: 'var(--color-primary-dark)' }}>{title}</h1>
        {subtitle && <p className="page-subtitle" style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}
