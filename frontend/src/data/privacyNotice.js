// The candidate privacy notice shown at /privacy and linked from the
// consent checkbox on the apply wizard's Submit step (FR-ATS-038).
//
// DRAFT: the consent wording and retention period are for UCAA Legal and
// Compliance to confirm (TBD-ATS-06). When the wording changes, bump
// PRIVACY_NOTICE_VERSION here AND in backend/src/config/privacyNotice.js -
// each application records the version its candidate consented to.
export const PRIVACY_NOTICE_VERSION = '2026-09-draft';
export const PRIVACY_NOTICE_IS_DRAFT = true;
export const PRIVACY_NOTICE_UPDATED = '30 September 2026';

export const PRIVACY_NOTICE_SECTIONS = [
  {
    heading: 'Who we are',
    body: [
      'The Uganda Civil Aviation Authority (UCAA) runs this recruitment system to fill positions in the Authority. '
        + 'UCAA is the data controller for the personal data you give us here.'
    ]
  },
  {
    heading: 'What we collect',
    body: [
      'Your account details (name, email address, phone number), your National ID or passport number, date of birth, '
        + 'place of residence and district of origin.',
      'Your education, work experience, certificates, exam grades and any other qualifications you add, and the documents '
        + 'you upload (CV, cover letter, academic documents).',
      'For each application: your answers to the application questions, your referees\' contact details, and the '
        + 'assessments made of you during shortlisting and interviews.'
    ]
  },
  {
    heading: 'How we use it',
    body: [
      'To assess your application against the requirements of the position, including automated checks of the minimum '
        + 'requirements the advert sets, and to shortlist, interview and select candidates.',
      'To contact you about your applications, and, if you are selected, to prepare your offer of appointment and '
        + 'hand your details over to UCAA\'s human resources records.'
    ]
  },
  {
    heading: 'Who sees it',
    body: [
      'UCAA human resources staff; the members of the shortlisting committee and interview panel for the positions you '
        + 'apply to, who see only the applicants assigned to them; and, for internal applicants, the supervisor you name.',
      'We do not sell your data or share it with anyone outside UCAA except where the law requires it.'
    ]
  },
  {
    heading: 'How long we keep it',
    body: [
      'We keep your application records for the period set by UCAA\'s records retention policy, after which they are '
        + 'deleted. [Retention period to be confirmed by UCAA Legal and Compliance.]'
    ]
  },
  {
    heading: 'Your rights',
    body: [
      'Under the Data Protection and Privacy Act, 2019, you may ask to see the personal data we hold about you, ask us to '
        + 'correct it, ask us to delete it, or withdraw your consent. Withdrawing consent means we can no longer consider '
        + 'your applications. You can correct most of your details yourself from your profile.',
      'To make a request, or to raise a concern about how your data is handled, contact UCAA\'s Human Resources '
        + 'department. [Contact address to be confirmed.]'
    ]
  }
];
