import React from 'react';
import Card from '../components/Card';
import { internalSiteUrl } from '../internalPort';

// What the public careers site shows while it is closed (backend
// config/externalSite.js): every page but the privacy notice and a
// shortlisting committee member's link (App.jsx).
export default function ExternalSiteClosed() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 16px' }}>
      <Card style={{ maxWidth: 560, width: '100%', padding: 28 }}>
        <h1 className="page-title" style={{ margin: '0 0 12px', color: 'var(--color-primary-dark)', fontSize: 26 }}>
          Our careers site is closed for now
        </h1>
        <p style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
          The Uganda Civil Aviation Authority isn&rsquo;t taking applications from external applicants on this site at the moment. Please check back later.
        </p>
        <p style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
          <strong>UCAA staff:</strong> internal vacancies are on{' '}
          <a href={internalSiteUrl()}>Internal Careers</a>. Sign in there with your work account.
        </p>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
          Questions: <a href="mailto:careers@caa.co.ug">careers@caa.co.ug</a>
        </p>
      </Card>
    </div>
  );
}
