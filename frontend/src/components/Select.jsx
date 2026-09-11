import React from 'react';

// ADDED: optional hint and required props, backward-compatible.
//
// Spacing/radius/background match TextField's - see its comment for why.
export default function Select({ label, hint, required, children, style, ...props }) {
  return (
    <label style={{ display: 'block', marginBottom: 22, maxWidth: 640 }}>
      {label && (
        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          {label}
          {required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
        </span>
      )}
      <select
        {...props}
        style={{
          display: 'block', width: '100%', padding: '11px 14px',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
          fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)',
          ...style
        }}
      >
        {children}
      </select>
      {hint && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</span>
      )}
    </label>
  );
}
