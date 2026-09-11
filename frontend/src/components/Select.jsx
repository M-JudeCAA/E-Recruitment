import React from 'react';

// ADDED: optional hint and required props, backward-compatible.
//
// Spacing/radius/background match TextField's - see its comment for why.
export default function Select({ label, hint, error, required, children, style, ...props }) {
  return (
    <label style={{ display: 'block', marginBottom: 20, maxWidth: 640 }}>
      {label && (
        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          {label}
          {required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
        </span>
      )}
      <select
        {...props}
        style={{
          display: 'block', width: '100%', padding: '10px 12px',
          border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)',
          fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)',
          ...style
        }}
      >
        {children}
      </select>
      {error ? (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>{error}</span>
      ) : hint && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</span>
      )}
    </label>
  );
}
