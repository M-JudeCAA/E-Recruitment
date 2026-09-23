import React from 'react';

// onClick is optional - passing it makes the whole card clickable (cursor
// + a hover lift via the .card-clickable rule in theme.css) without
// affecting every other Card that doesn't pass one. className is also
// optional and purely additive (e.g. Home.jsx's "hover-lift" - see
// theme.css) - existing call sites that don't pass one are unaffected.
export default function Card({ children, accent, style, onClick, className }) {
  return (
    <div
      onClick={onClick}
      className={[onClick ? 'card-clickable' : null, className].filter(Boolean).join(' ') || undefined}
      style={{
        border: '1px solid var(--color-border)',
        borderLeft: accent ? `4px solid ${accent}` : '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--spacing-md)',
        marginBottom: 'var(--spacing-md)',
        background: 'var(--color-bg)',
        boxShadow: '0 1px 3px rgba(20,24,28,0.06)',
        cursor: onClick ? 'pointer' : undefined,
        ...style
      }}
    >
      {children}
    </div>
  );
}
