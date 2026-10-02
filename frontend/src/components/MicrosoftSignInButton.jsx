import React from 'react';
import Button from './Button';

// The four-square mark Microsoft asks sign-in buttons to carry.
function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export default function MicrosoftSignInButton({ children = 'Sign in with Microsoft', loading, onClick, style }) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      loading={loading}
      loadingText="Signing in..."
      style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontWeight: 600, ...style }}
    >
      <MicrosoftMark />
      {children}
    </Button>
  );
}
