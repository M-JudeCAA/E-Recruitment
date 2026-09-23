import React from 'react';
import { Link } from 'react-router-dom';

const linkStyle = { color: 'var(--color-text-muted)' };

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
        <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* /#faq only ever resolves meaningfully from Home.jsx (the only
              route with a #faq section) - Home's own hash-scroll effect
              handles the actual scrolling once routed there. Fine to show
              everywhere, same as the always-visible email beside it. */}
          <Link to="/#faq" style={linkStyle}>FAQ</Link>
          <a href="mailto:careers@caa.co.ug" style={linkStyle}>Careers help: careers@caa.co.ug</a>
        </span>
      </div>
    </footer>
  );
}
