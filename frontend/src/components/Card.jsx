import React from 'react';

export default function Card({ children, accent, style }) {
  return (
    <div
      data-card
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderLeft: accent ? `3px solid ${accent}` : '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--spacing-lg)',
        marginBottom: 'var(--spacing-md)',
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-xs)',
        ...style
      }}
    >
      {children}
    </div>
  );
}
