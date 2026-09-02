import React from 'react';

export default function Select({ label, children, style, ...props }) {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--spacing-md)' }}>
      {label && (
        <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          {label}
        </span>
      )}
      <select
        {...props}
        style={{
          display: 'block', width: '100%', padding: 8,
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
          fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg)',
          ...style
        }}
      >
        {children}
      </select>
    </label>
  );
}
