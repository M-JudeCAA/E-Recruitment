import React from 'react';

// ADDED: optional actions slot (e.g. a primary button) and eyebrow -
// backward-compatible, every existing caller that only passes
// title/subtitle renders exactly as before, just with refreshed type.
export default function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      gap: 'var(--spacing-md)', flexWrap: 'wrap', marginBottom: 'var(--spacing-lg)'
    }}>
      <div>
        {eyebrow && (
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: 4 }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--color-text)', letterSpacing: -0.2 }}>{title}</h1>
        {subtitle && <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}
