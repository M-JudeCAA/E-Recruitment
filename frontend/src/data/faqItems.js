import { HEAD_OFFICE_CONTACTS } from '../components/HowToApplyBlock';

// Single source of truth for the candidate-facing FAQ content - both the
// on-page accordion (Home.jsx, kept for accessibility/SEO: real crawlable
// text, works with no JS interaction beyond a click) and the floating
// FaqChatWidget (a chat-styled skin over these exact same canned answers,
// not an LLM - see that component's own comment for why) read from here,
// so the two can never drift apart.
//
// Answers are grounded in what this app actually does (registration, the
// draft/submit/withdraw workflow, one-application-per-vacancy - see
// applicationDraftController.js) rather than generic filler. The
// fee/fraud warning is standard practice for a public-sector recruiter's
// own portal, not behavior read from the code - HR should confirm the
// exact wording before this goes live.
export const FAQ_ITEMS = [
  {
    q: 'Is there a fee to apply?',
    a: `No. UCAA never charges a fee at any stage of recruitment - application, shortlisting, interview, or offer. If anyone asks you for money in UCAA's name, do not pay, and report it to Head Office: ${HEAD_OFFICE_CONTACTS.join(', ')}.`
  },
  {
    q: 'Do I need to create an account before I can apply?',
    a: 'Yes. Create a free candidate account, then apply from the Open Positions list below. Your profile (education, experience) is saved once and reused for every application you submit.'
  },
  {
    q: "What's the difference between an Internal and External vacancy?",
    a: 'Internal vacancies are open only to current UCAA staff, verified by your work email address at registration. Everyone else applies to External vacancies. You will only see and be able to apply to the vacancies that match your account type.'
  },
  {
    q: 'What documents do I need?',
    a: 'A CV is required for every application. A cover letter is optional. Some vacancies also ask a few short screening questions as part of the application.'
  },
  {
    q: 'Can I apply for more than one vacancy?',
    a: "Yes, you can apply to as many different open vacancies as you're eligible for. You can only submit one application per vacancy."
  },
  {
    q: 'Can I edit or withdraw my application after submitting it?',
    a: 'You can edit a saved draft freely before you submit it. Once submitted, you can no longer edit it, but you can withdraw it from your dashboard at any time before a decision is made.'
  },
  {
    q: 'What happens after I submit my application?',
    a: "Your application is reviewed against the vacancy's requirements. If shortlisted, you'll be invited to interview; if successful, you'll receive an offer. You can track your status from your dashboard at every stage, and you'll be notified of major updates by email."
  }
];
