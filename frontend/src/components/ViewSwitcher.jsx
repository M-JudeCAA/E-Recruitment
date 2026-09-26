import React from 'react';
import { List, Table2, Columns3 } from 'lucide-react';

const ALL_MODES = [
  { key: 'list', label: 'List', icon: List },
  { key: 'table', label: 'Table', icon: Table2 },
  { key: 'board', label: 'Board', icon: Columns3 },
];

// A segmented List/Table/Board toggle, reused on every list page that
// offers more than one view of the same underlying data. `modes` narrows
// which of the three a given page actually supports (e.g. a page with no
// natural status-like grouping might only offer List + Table). The current
// mode is owned by the caller (usually synced to a `?view=` URL param, the
// same pattern already used for filters elsewhere in this app) so Back/
// Forward and reload restore it, and a shared link can point straight at
// a specific view.
export default function ViewSwitcher({ view, onChange, modes = ['list', 'table', 'board'] }) {
  const available = ALL_MODES.filter((m) => modes.includes(m.key));
  const active = modes.includes(view) ? view : modes[0];
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0 }}>
      {available.map((m, i) => {
        const Icon = m.icon;
        const isActive = m.key === active;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            title={`${m.label} view`}
            aria-label={`${m.label} view`}
            aria-pressed={isActive}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13,
              border: 'none', borderRight: i < available.length - 1 ? '1px solid var(--color-border)' : 'none',
              cursor: 'pointer', fontWeight: isActive ? 600 : 400,
              background: isActive ? 'var(--color-primary)' : 'var(--color-bg)',
              color: isActive ? '#fff' : 'var(--color-text-muted)'
            }}
          >
            <Icon size={14} /> {m.label}
          </button>
        );
      })}
    </div>
  );
}
