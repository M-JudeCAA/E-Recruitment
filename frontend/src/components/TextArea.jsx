import React from 'react';

// ADDED: optional hint and required props, matching TextField/Select -
// backward-compatible, every existing caller that doesn't pass them
// behaves exactly as before.
export default function TextArea({ label, hint, required, style, ...props }) {
  return (
    <label style={{ display: 'block', marginBottom: 22 }}>
      {label && (
        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          {label}
          {required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
        </span>
      )}
      <textarea
        {...props}
        rows={props.rows || 4}
        style={{
          display: 'block', width: '100%', padding: '11px 14px',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
          fontSize: 'inherit', fontFamily: 'inherit', resize: 'vertical',
          background: 'var(--color-bg-input)',
          ...style
        }}
      />
      {hint && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</span>
      )}
    </label>
  );
}
