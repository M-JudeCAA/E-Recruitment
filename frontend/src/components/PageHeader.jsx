import React from 'react';

export default function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 'var(--spacing-lg)' }}>
      <h1 style={{ margin: 0, color: 'var(--color-primary-dark)' }}>{title}</h1>
      {subtitle && <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>{subtitle}</p>}
    </div>
  );
}
