import React from 'react';

export default function Card({ children, accent, style }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderLeft: accent ? `4px solid ${accent}` : '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--spacing-md)',
        marginBottom: 'var(--spacing-md)',
        background: 'var(--color-bg)',
        ...style
      }}
    >
      {children}
    </div>
  );
}
