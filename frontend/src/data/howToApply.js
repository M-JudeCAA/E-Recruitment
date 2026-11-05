import { internalSiteUrl, publicSiteUrl } from '../internalPort';

// The "How to apply" steps on an advert - on the page (HowToApplyBlock) and
// in the downloaded PDF (VacancyAdvertPrintLayout) - kept here so the two
// say the same thing and match what the application actually asks for:
// three referees, at least one academic document, the evidence the vacancy
// asks for, an optional CV, consent (applicationDraftController.submit).
//
// The address is the site the vacancy is advertised on, never the page's
// own origin - an advert previewed on the staff site, or an Internal one,
// must not send candidates to the HR workspace or the public site.
// Internal vacancies: Microsoft sign-in, no registration, and HR verifies
// employment before an application can be submitted (employmentCheck.js).
export function howToApply(postingType) {
  const internal = postingType === 'Internal';
  const siteUrl = internal ? internalSiteUrl() : publicSiteUrl();
  const steps = internal ? [
    `Visit ${siteUrl} and sign in with your UCAA Microsoft account. There is no need to register.`,
    'Complete your profile, including your UCAA employment details (employee number, department and position). HR verifies your employment before you can submit an application, so do this early.',
    'Open Vacancies, choose this vacancy and click "Apply".'
  ] : [
    `Visit ${siteUrl} and create an account with your email address (new users), or sign in (returning users).`,
    'Complete your profile: personal details, education, work experience and certificates. You can fill it in from your CV.',
    'Choose this vacancy from the list of open jobs and click "Apply".'
  ];
  return {
    siteUrl,
    steps: [
      ...steps,
      'Answer the questions, name three referees, and upload your academic documents (certificates, transcripts, result slips) and any evidence the vacancy asks for. A CV is optional.',
      'Review your application and submit it. A confirmation is shown once it has been received, and you can follow its progress under My applications.',
      'Falsification of information is an offence at UCAA. Only apply for vacancies where you meet the minimum requirements in the job description, and answer the application questions honestly.',
      'Only applications submitted through this system are accepted. Physical/hard copy applications will not be accepted.'
    ]
  };
}
