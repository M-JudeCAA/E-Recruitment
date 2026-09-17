import React from 'react';

// Generic Kanban-style board - the third view alternative alongside List
// and Table. `columns` is [{ key, label, color }] in display order;
// `groupBy(item)` returns which column key an item belongs to (an item
// whose key matches no column is silently dropped, same as a filter that
// excludes it - callers should make sure `columns` covers every value
// `groupBy` can return for the data in play). `renderCard` renders one
// item's card content - callers own their own card markup/actions so this
// stays a pure layout component, not a duplicate of List view's card.
export default function BoardView({ columns, items, groupBy, renderCard, getItemKey, emptyText = 'Nothing to show.' }) {
  if (!items || items.length === 0) {
    return (
      <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
        {emptyText}
      </div>
    );
  }
  const grouped = columns.map((col) => ({
    ...col,
    items: items.filter((item) => groupBy(item) === col.key)
  }));
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
      {grouped.map((col) => (
        <div key={col.key} style={{ flex: '0 0 270px', width: 270 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 2px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color || 'var(--color-primary)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{col.label}</span>
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', background: 'var(--color-bg-subtle)',
              borderRadius: 999, padding: '1px 8px', marginLeft: 'auto'
            }}>
              {col.items.length}
            </span>
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8, minHeight: 48,
            background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius)', padding: 8
          }}>
            {col.items.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '14px 0' }}>—</div>
            ) : col.items.map((item) => <React.Fragment key={getItemKey(item)}>{renderCard(item)}</React.Fragment>)}
          </div>
        </div>
      ))}
    </div>
  );
}
