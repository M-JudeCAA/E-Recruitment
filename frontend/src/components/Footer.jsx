import React from 'react';

export default function Footer() {
  return (
    <footer
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'var(--footer-height)',
        zIndex: 100,
        width: '100%',
        background: 'var(--color-bg)',
        borderTop: '1px solid var(--color-border)',
        padding: '0 24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          height: '100%',
          maxWidth: 1160,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
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
