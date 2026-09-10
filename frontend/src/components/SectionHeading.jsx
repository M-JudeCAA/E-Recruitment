import React from 'react';

// Shared section title for the list/table-like blocks under a
// dashboard's forms (e.g. "Vacancies", "My applications") - replaces
// bare <h3> tags so every dashboard gets the same rhythm and an optional
// trailing count/action without re-implementing the row each time.
export default function SectionHeading({ children, count, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      margin: '28px 0 12px'
    }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
        {children}
        {count !== undefined && (
          <span style={{
            fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)',
            background: 'var(--color-bg-subtle)', borderRadius: 999, padding: '1px 8px'
          }}>
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}
