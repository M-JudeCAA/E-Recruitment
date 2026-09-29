import React from 'react';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Alert from '../components/Alert';
import {
  PRIVACY_NOTICE_SECTIONS, PRIVACY_NOTICE_UPDATED, PRIVACY_NOTICE_VERSION, PRIVACY_NOTICE_IS_DRAFT
} from '../data/privacyNotice';

// Public - candidates consent to this notice when they submit an
// application (see SubmitStep.jsx), and must be able to read it first.
export default function PrivacyNotice() {
  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader title="Privacy notice for job applicants" subtitle={`Last updated ${PRIVACY_NOTICE_UPDATED} · version ${PRIVACY_NOTICE_VERSION}`} />
      {PRIVACY_NOTICE_IS_DRAFT && (
        <Alert type="warning" message="This notice is a draft awaiting review by UCAA Legal and Compliance." />
      )}
      <Card>
        {PRIVACY_NOTICE_SECTIONS.map((section) => (
          <section key={section.heading} style={{ marginBottom: 'var(--spacing-md)' }}>
            <h2 style={{ fontSize: 16, margin: '0 0 var(--spacing-sm)' }}>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 var(--spacing-sm)' }}>{paragraph}</p>
            ))}
          </section>
        ))}
      </Card>
    </div>
  );
}
