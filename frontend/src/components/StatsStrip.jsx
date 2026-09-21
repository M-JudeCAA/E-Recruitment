import React from 'react';

// Small inline stat chips - derived from data the caller already has in
// hand (no request of its own). Shared by HRDashboard's per-tab strips and
// HRHome's screening-breakdown panel.
export default function StatsStrip({ stats }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
      {stats.map((s) => (
        <div key={s.label} style={{
          display: 'flex', alignItems: 'baseline', gap: 6, padding: '8px 14px',
          background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: s.color || 'var(--color-text)' }}>{s.value}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
