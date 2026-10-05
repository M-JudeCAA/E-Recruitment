import React, { useEffect, useState } from 'react';

// Shown in every WS-connected dashboard header - see models/dashboardSocket.js
// for what `connected` actually tracks. Live updates are the normal state, so
// nothing shows while connected, nor during the few seconds a page takes to
// connect; the notice appears only once updates have been off for a while.
const GRACE_MS = 8000;

export default function LiveIndicator({ connected }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (connected) { setStale(false); return undefined; }
    const timer = setTimeout(() => setStale(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  if (connected || !stale) return null;
  return (
    <div role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--color-text-muted)' }} />
      Live updates paused - reload to see the latest
    </div>
  );
}
