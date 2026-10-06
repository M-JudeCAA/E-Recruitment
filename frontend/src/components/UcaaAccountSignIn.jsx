import React from 'react';
import { internalSiteUrl } from '../internalPort';

// On the public careers site's login and registration pages: UCAA
// employees apply on Internal Careers (its own port, internalPort.js),
// signing in there with their Microsoft work account - so this is a link
// there, not a sign-in button. `highlight` when the person just tried to
// use a UCAA address here (400 USE_MICROSOFT). returnTo is accepted for
// the callers' sake and not needed: Internal Careers has its own pages.
export default function UcaaAccountSignIn({ highlight = false }) {
  return (
    <div style={{
      marginTop: 4, marginBottom: 18, padding: 12, borderRadius: 'var(--radius-sm)',
      background: highlight ? 'var(--color-warning-light)' : 'var(--color-primary-light)',
      color: highlight ? 'var(--color-warning)' : 'var(--color-primary-dark)', fontSize: 13
    }}>
      <strong>UCAA staff:</strong> internal vacancies and your applications are on{' '}
      <a href={`${internalSiteUrl()}/careers`} style={{ color: 'inherit', fontWeight: 600 }}>Internal Careers</a>.
      Sign in there with your work account - no password needed.
    </div>
  );
}
