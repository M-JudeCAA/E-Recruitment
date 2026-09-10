import React from 'react';

// Compact summary tile for dashboard "at a glance" strips. Deliberately
// not built on Card - it needs a tighter, denser layout than a content
// card (icon chip + number + label in a row), so it composes its own
// surface instead of fighting Card's padding/shadow defaults.
export default function StatTile({ icon: Icon, label, value, color = 'var(--color-primary)', tint = 'var(--color-primary-tint)' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-lg)', padding: '14px 16px', boxShadow: 'var(--shadow-xs)',
      flex: '1 1 160px', minWidth: 160
    }}>
      {Icon && (
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 38, height: 38, borderRadius: 10, background: tint, color, flexShrink: 0
        }}>
          <Icon size={18} />
        </span>
      )}
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{label}</div>
      </div>
    </div>
  );
}
