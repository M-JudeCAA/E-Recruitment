import React from 'react';

// ADDED: optional hint and required props, backward-compatible - every
// existing caller that doesn't pass them behaves exactly as before.
//
// Spacing/radius/background here match the application-wizard prototype's
// form-field styling (Field/inputStyle in its theme.js) - adopted app-wide
// since every form in the system already renders through this component.
export default function TextField({ label, hint, error, required, style, ...inputProps }) {
  return (
    <label style={{ display: 'block', marginBottom: 22, maxWidth: 640 }}>
      {label && (
        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          {label}
          {required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
        </span>
      )}
      <input
        {...inputProps}
        style={{
          display: 'block',
          width: '100%',
          padding: '11px 14px',
          border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          fontSize: 'inherit',
          fontFamily: 'inherit',
          background: 'var(--color-bg-input)',
          ...style
        }}
      />
      {error ? (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>{error}</span>
      ) : hint && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</span>
      )}
    </label>
  );
}
