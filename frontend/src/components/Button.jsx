import React from 'react';

const VARIANTS = {
  primary: { background: 'var(--color-primary)', color: '#fff', border: '1px solid var(--color-primary)' },
  secondary: { background: '#fff', color: 'var(--color-primary)', border: '1px solid var(--color-border)' },
  danger: { background: 'var(--color-danger)', color: '#fff', border: '1px solid var(--color-danger)' },
  ghost: { background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid transparent' }
};

// data-btn drives the :hover/:active states in theme.css - inline styles
// can't express pseudo-classes, and these buttons are used everywhere
// from dense card rows to full forms, so the feedback needs to live in
// one shared place rather than being re-implemented per call site.
export default function Button({ variant = 'primary', children, style, disabled, ...props }) {
  return (
    <button
      {...props}
      data-btn={variant}
      disabled={disabled}
      style={{
        ...VARIANTS[variant],
        padding: '9px 16px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'inherit',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--transition), border-color var(--transition), box-shadow var(--transition)',
        ...style
      }}
    >
      {children}
    </button>
  );
}
