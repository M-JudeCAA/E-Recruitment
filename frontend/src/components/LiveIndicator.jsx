import React from 'react';

// Small dot + status text reused in every WS-connected dashboard header -
// see models/dashboardSocket.js for what `connected` actually tracks.
export default function LiveIndicator({ connected }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: connected ? 'var(--color-accent)' : 'var(--color-text-muted)',
          boxShadow: connected ? '0 0 0 3px var(--color-primary-light)' : 'none',
          transition: 'background-color 0.2s ease'
        }}
      />
      {connected ? 'Live' : 'Reconnecting…'}
    </div>
  );
}
