import React from 'react';

// Small inline stat chips - derived from data the caller already has in
// hand (no request of its own). Shared by HRDashboard's per-tab strips and
// HRHome's screening-breakdown panel.
//
// `onSelect` is optional - passing it turns every chip into a button that
// calls onSelect(stat) (e.g. HRDashboard's vacancy-status tiles toggling
// statusFilter), rendered with `activeLabel` marking the currently-selected
// one. Callers that don't pass onSelect (HRHome's screening panel,
// HRDashboard's own offerStats - no matching filter state exists for those
// yet) keep rendering the exact same static, non-interactive chips as
// before.
export default function StatsStrip({ stats, onSelect, activeLabel }) {
  const clickable = typeof onSelect === 'function';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
      {stats.map((s) => {
        const isActive = clickable && activeLabel === s.label;
        const Tag = clickable ? 'button' : 'div';
        return (
          <Tag
            key={s.label}
            type={clickable ? 'button' : undefined}
            onClick={clickable ? () => onSelect(s) : undefined}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 6, padding: '8px 14px',
              background: isActive ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)',
              border: isActive ? '1px solid var(--color-primary)' : '1px solid transparent',
              borderRadius: 'var(--radius-sm)',
              cursor: clickable ? 'pointer' : undefined,
              font: clickable ? 'inherit' : undefined,
              textAlign: 'left'
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700, color: s.color || 'var(--color-text)' }}>{s.value}</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{s.label}</span>
          </Tag>
        );
      })}
    </div>
  );
}
