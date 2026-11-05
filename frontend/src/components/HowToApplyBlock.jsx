import React from 'react';
import { formatDeadlineDay, formatDeadlineTime } from '../utils/deadline';
import { howToApply } from '../data/howToApply';

// UCAA's standard "How to Apply" instructions, matching the wording used
// on every UCAA job advertisement. Deliberately NOT an HR-editable field
// on the vacancy - it's the same organisation-wide boilerplate on every
// advert, so it's attached here at render time rather than stored (and
// re-typed, and allowed to drift) per vacancy. The one part that does
// vary per vacancy - the application deadline - is passed in and reused
// from the same `deadline` value already shown in the advert's header
// facts, so the two can never disagree with each other.
// Exported so other guest-facing copy (Home.jsx's FAQ) can point candidates
// at the same numbers without re-typing them and risking the two drifting.
export const HEAD_OFFICE_CONTACTS = ['+256 414 352000', '+256 312 352000', '+256 20 0452000'];

export default function HowToApplyBlock({ deadline, postingType }) {
  const { steps } = howToApply(postingType);
  const deadlineText = deadline
    ? `Applications must be received not later than ${formatDeadlineTime(deadline)}, ${formatDeadlineDay(deadline)}.`
    : null;

  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
      <h4 style={{ marginBottom: 6 }}>How to Apply</h4>
      <ol style={{ paddingLeft: 20, fontSize: 13, marginTop: 0 }}>
        {steps.map((step) => <li key={step}>{step}</li>)}
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
