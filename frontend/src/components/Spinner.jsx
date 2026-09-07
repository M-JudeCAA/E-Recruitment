import React from 'react';

// Self-contained (SVG's own SMIL animation, no CSS keyframes needed) so it
// drops in anywhere without touching theme.css. Used wherever a page waits
// on a DB-backed request - see Home.jsx and ApplyForm.jsx - so the wait
// reads as "loading" rather than "broken" while the request is in flight.
export default function Spinner({ size = 22, color = 'var(--color-primary)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" role="status" aria-label="Loading">
      <circle
        cx="25" cy="25" r="20" fill="none" stroke={color} strokeWidth="5"
        strokeLinecap="round" strokeDasharray="90 60"
      >
        <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
