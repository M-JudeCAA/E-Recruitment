import React from 'react';
import Spinner from './Spinner';

// Shared "waiting on a DB-backed request" placeholder - centered spinner
// plus a short label, generous vertical padding so it doesn't read as an
// empty/broken page while the request is in flight.
export default function LoadingState({ label = 'Loading...' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '48px 0' }}>
      <Spinner />
      <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  );
}
