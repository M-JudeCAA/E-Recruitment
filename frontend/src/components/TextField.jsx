import React from 'react';
import { formatAs } from '../utils/textCase';

// ADDED: optional hint and required props, backward-compatible - every
// existing caller that doesn't pass them behaves exactly as before.
//
// Spacing/radius/background here match the application-wizard prototype's
// form-field styling (Field/inputStyle in its theme.js) - adopted app-wide
// since every form in the system already renders through this component.
//
// format ('name' | 'title' | 'email' | 'code', utils/textCase.js): when the
// field is left, a value typed in capitals or lower case is cased the way the
// server will store it, through the field's own onChange.
export default function TextField({ label, hint, error, required, style, format, ...inputProps }) {
  if (format) {
    const { onBlur, onChange } = inputProps;
    inputProps.onBlur = (e) => {
      const tidy = formatAs(format, e.target.value);
      if (onChange && tidy !== e.target.value) onChange({ target: { value: tidy, name: e.target.name, type: e.target.type } });
      onBlur?.(e);
    };
  }
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
