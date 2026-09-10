import React from 'react';

// Slim bar above the routed content in a sidebar dashboard shell - holds
// whatever quick-access widgets don't belong in the nav rail itself
// (e.g. the notification bell, which needs room for its dropdown).
export default function DashboardTopBar({ right }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      minHeight: 56, padding: '0 24px',
      background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border-subtle)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{right}</div>
    </div>
  );
}
