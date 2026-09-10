import React from 'react';

// UCAA's standard "How to Apply" instructions, matching the wording used
// on every UCAA job advertisement. Deliberately NOT an HR-editable field
// on the vacancy - it's the same organisation-wide boilerplate on every
// advert, so it's attached here at render time rather than stored (and
// re-typed, and allowed to drift) per vacancy. The one part that does
// vary per vacancy - the application deadline - is passed in and reused
// from the same `deadline` value already shown in the advert's header
// facts, so the two can never disagree with each other.
const HEAD_OFFICE_CONTACTS = ['+256 414 352000', '+256 312 352000', '+256 20 0452000'];

export default function HowToApplyBlock({ deadline }) {
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const deadlineText = deadline
    ? `Applications must be received not later than 5:00pm, ${new Date(deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`
    : null;

  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
      <h4 style={{ marginBottom: 6 }}>How to Apply</h4>
      <ol style={{ paddingLeft: 20, fontSize: 13, marginTop: 0 }}>
        <li>Visit {siteUrl || 'this system'} to create an account and start your application (new users: sign up; returning users: log in).</li>
        <li>Complete your candidate profile, including education and work experience, before applying.</li>
        <li>Find this vacancy from the Home page and click "Apply" to begin your application.</li>
        <li>Complete every step of the application - profile, documents (a CV is required), and questions - and review it before sending.</li>
        <li>Submit your application. A confirmation will be shown once it has been received.</li>
        <li>Falsification of information is an offense at UCAA. Only apply for vacancies where you genuinely meet the minimum requirements, and answer the application questions honestly.</li>
        <li>Only applications submitted through this system are accepted - physical/hard copy applications will not be entertained.</li>
      </ol>
      <p style={{ fontSize: 13, marginBottom: 4 }}>
        For any inquiries or assistance, please contact: Head Office: {HEAD_OFFICE_CONTACTS.join(', ')}
      </p>
      {deadlineText && <p style={{ fontSize: 13, marginBottom: 4 }}>{deadlineText}</p>}
      <p style={{ fontSize: 13, marginBottom: 4 }}>
        It is the duty of the applicant to ensure their application is received by the indicated date - late applications will not be entertained under any circumstances.
      </p>
      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 0 }}>We pledge to conduct a transparent recruitment process!</p>
    </div>
  );
}
