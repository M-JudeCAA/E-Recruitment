import React from 'react';

export default function Footer() {
  return (
    <footer
      style={{
        width: '100%',
        borderTop: '1px solid var(--color-border)',
        marginTop: 'var(--spacing-lg)',
        padding: 'var(--spacing-md) 24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 1160,
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: 'var(--spacing-sm)',
          fontSize: 12.5,
          color: 'var(--color-text-muted)',
        }}
      >
        <span>&copy; {new Date().getFullYear()} Uganda Civil Aviation Authority</span>
        <span>Careers help: careers@caa.co.ug</span>
      </div>
    </footer>
  );
}
