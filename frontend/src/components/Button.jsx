import React from 'react';
import Spinner from './Spinner';

const VARIANTS = {
  primary: { background: 'var(--color-primary)', color: '#fff', border: 'none' },
  secondary: { background: '#fff', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' },
  danger: { background: 'var(--color-danger)', color: '#fff', border: 'none' },
  ghost: { background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }
};

// `loading` covers the gap between click and response on a button that
// triggers a request - without it, a slow request just looks unresponsive
// (see ProfileCompletionForm/ProfileStep's add/save/delete buttons, which
// used to only flip a bare "Saving..." label with no visual cue that the
// click actually registered). `loadingText`, if given, replaces the label
// while loading; otherwise the children stay and only the spinner is added.
export default function Button({ variant = 'primary', children, style, disabled, loading, loadingText, ...props }) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...props}
      disabled={isDisabled}
      style={{
        ...VARIANTS[variant],
        padding: '8px 16px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'inherit',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...style
      }}
    >
      {loading && <Spinner size={13} color="currentColor" />}
      {loading && loadingText !== undefined ? loadingText : children}
    </button>
  );
}
