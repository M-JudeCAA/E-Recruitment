import React from 'react';

const VARIANTS = {
  primary: { background: 'var(--color-primary)', color: '#fff', border: 'none' },
  secondary: { background: '#fff', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' },
  danger: { background: 'var(--color-danger)', color: '#fff', border: 'none' },
  ghost: { background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }
};

export default function Button({ variant = 'primary', children, style, disabled, ...props }) {
  return (
    <button
      {...props}
      disabled={disabled}
      style={{
        ...VARIANTS[variant],
        padding: '8px 16px',
        borderRadius: 'var(--radius)',
        fontSize: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style
      }}
    >
      {children}
    </button>
  );
}
