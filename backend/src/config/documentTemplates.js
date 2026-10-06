// The documents the system prints, with UCAA's own default wording until
// HR supplies its official templates. HR Manager+ can edit any of them on
// the Templates page (DocumentTemplate rows hold the edits; "reset" deletes
// the row and the default below applies again) - see services/templateService.js.
//
// Bodies are HTML with placeholders: {{name}} is replaced by an escaped
// value; a placeholder listed under `blocks` is generated markup (a table
// or list) and is inserted as it is. Every placeholder a template can use is
// listed with it, and only those are filled.

const LETTERHEAD = '<p style="text-align: center"><strong>UGANDA CIVIL AVIATION AUTHORITY</strong><br>'
  + 'Passenger Terminal Building, Entebbe International Airport<br>P.O. Box 5536, Kampala, Uganda</p>';

const SIGNATURE = '<p>Yours sincerely,</p><p><br><br>______________________________<br>'
  + '<strong>{{signatoryTitle}}</strong><br>For: Director General</p>';

const CANDIDATE = [
  { key: 'date', label: 'Today\'s date' },
  { key: 'candidateName', label: 'Candidate\'s full name' },
  { key: 'candidateAddress', label: 'Candidate\'s place of residence' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'jobRef', label: 'Job reference' },
  { key: 'department', label: 'Department' },
  { key: 'signatoryTitle', label: 'Signatory\'s title' }
];

// What an email to a candidate can use. For a candidate picked in the
// candidate search, the job is that of their most recent application.
const EMAIL = [
  { key: 'date', label: 'Today\'s date' },
  { key: 'candidateName', label: 'Candidate\'s full name' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'jobRef', label: 'Job reference' },
  { key: 'department', label: 'Department' }
];

const OFFER = [
  ...CANDIDATE,
  { key: 'salary', label: 'Salary, e.g. UGX 4,500,000 per month' },
  { key: 'allowances', label: 'Allowances' },
  { key: 'employmentType', label: 'Type of employment, e.g. Permanent and pensionable' },
  { key: 'contractTerm', label: 'Contract term, e.g. 24 months (blank if permanent)' },
  { key: 'startDate', label: 'Start date' },
  { key: 'dutyStation', label: 'Duty station' },
  { key: 'responseDeadline', label: 'Date the candidate must answer by' },
  { key: 'conditionsList', label: 'Conditions of the offer (a list)', block: true }
];

const DEFAULTS = {
  offerLetter: {
    name: 'Offer of employment',
    description: 'The letter offering the job, printed or saved as PDF once the offer is approved. The candidate can download it too.',
    placeholders: OFFER,
    body: `${LETTERHEAD}
<p>{{date}}</p>
<p>{{candidateName}}<br>{{candidateAddress}}</p>
<p><strong>RE: OFFER OF EMPLOYMENT AS {{jobTitle}} ({{jobRef}})</strong></p>
<p>Dear {{candidateName}},</p>
<p>Following your application and the interview, I am pleased to offer you the position of <strong>{{jobTitle}}</strong> in the {{department}} department of the Uganda Civil Aviation Authority, on the following terms:</p>
<table>
<tbody>
<tr><td>Salary</td><td>{{salary}}</td></tr>
<tr><td>Allowances</td><td>{{allowances}}</td></tr>
<tr><td>Terms of employment</td><td>{{employmentType}} {{contractTerm}}</td></tr>
<tr><td>Duty station</td><td>{{dutyStation}}</td></tr>
<tr><td>Expected start date</td><td>{{startDate}}</td></tr>
</tbody>
</table>
<p>This offer is subject to the following conditions:</p>
{{conditionsList}}
<p>Please confirm whether you accept this offer by <strong>{{responseDeadline}}</strong>, through your account on the e-Recruitment portal. If we do not hear from you by then, the offer will lapse.</p>
<p>We look forward to welcoming you to the Authority.</p>
${SIGNATURE}`
  },

  appointmentInstrument: {
    name: 'Appointing instrument',
    description: 'The letter of appointment, once the candidate has accepted the offer.',
    placeholders: [...OFFER, { key: 'acceptedDate', label: 'Date the offer was accepted' }],
    body: `${LETTERHEAD}
<p>{{date}}</p>
<p>{{candidateName}}<br>{{candidateAddress}}</p>
<p><strong>RE: APPOINTMENT AS {{jobTitle}} ({{jobRef}})</strong></p>
<p>Dear {{candidateName}},</p>
<p>Further to your acceptance on {{acceptedDate}} of our offer of employment, I am pleased to appoint you to the position of <strong>{{jobTitle}}</strong> in the {{department}} department, with effect from <strong>{{startDate}}</strong>.</p>
<p>Your appointment is {{employmentType}} {{contractTerm}}, at a salary of {{salary}}, with the following allowances: {{allowances}}. Your duty station is {{dutyStation}}.</p>
<p>Your appointment remains subject to the conditions set out in the offer:</p>
{{conditionsList}}
<p>You will serve a probation period as provided in the Authority's Human Resource Manual, and your appointment is governed by the Authority's terms and conditions of service as amended from time to time.</p>
<p>Please report to the Human Resource office on your first day with the originals of your academic and professional documents and your National ID.</p>
<p>Congratulations on your appointment.</p>
${SIGNATURE}
<p>I accept this appointment on the terms set out above.</p>
<p>Signature: ______________________ &nbsp; Date: ______________</p>`
  },

  interviewInvitation: {
    name: 'Interview invitation letter',
    description: 'A formal letter inviting a candidate to interview - for candidates who need one on paper. The email and calendar invitation go out on their own.',
    placeholders: [
      ...CANDIDATE,
      { key: 'interviewDate', label: 'Interview date' },
      { key: 'interviewTime', label: 'Interview time' },
      { key: 'venue', label: 'Venue, meeting link or phone' },
      { key: 'instructions', label: 'Instructions for the candidate' }
    ],
    body: `${LETTERHEAD}
<p>{{date}}</p>
<p>{{candidateName}}<br>{{candidateAddress}}</p>
<p><strong>RE: INVITATION TO INTERVIEW FOR THE POSITION OF {{jobTitle}} ({{jobRef}})</strong></p>
<p>Dear {{candidateName}},</p>
<p>Following your application, you have been shortlisted for interview for the position of <strong>{{jobTitle}}</strong>.</p>
<p>The interview will be held on <strong>{{interviewDate}}</strong> at <strong>{{interviewTime}}</strong>, at {{venue}}.</p>
<p>{{instructions}}</p>
<p>Please confirm your attendance through your account on the e-Recruitment portal.</p>
${SIGNATURE}`
  },

  regretLetter: {
    name: 'Regret letter',
    description: 'The letter telling a candidate their application was not successful.',
    placeholders: CANDIDATE,
    body: `${LETTERHEAD}
<p>{{date}}</p>
<p>{{candidateName}}<br>{{candidateAddress}}</p>
<p><strong>RE: YOUR APPLICATION FOR THE POSITION OF {{jobTitle}} ({{jobRef}})</strong></p>
<p>Dear {{candidateName}},</p>
<p>Thank you for your interest in working with the Uganda Civil Aviation Authority and for the time you gave to your application.</p>
<p>We regret to inform you that your application was not successful on this occasion. We received many applications, and the selection was competitive.</p>
<p>We encourage you to apply for future vacancies that match your qualifications and experience, and we wish you the very best.</p>
${SIGNATURE}`
  },

  excoShortlist: {
    name: 'Interview shortlist for EXCO',
    description: 'The approved interview shortlist, printed for EXCO to approve and sign.',
    placeholders: [
      { key: 'date', label: 'Today\'s date' },
      { key: 'jobTitle', label: 'Job title' },
      { key: 'jobRef', label: 'Job reference' },
      { key: 'department', label: 'Department' },
      { key: 'positionsRequired', label: 'Number of positions' },
      { key: 'dutyStation', label: 'Duty station' },
      { key: 'salaryScale', label: 'Salary scale' },
      { key: 'shortlistTable', label: 'The shortlist (a table)', block: true }
    ],
    body: `${LETTERHEAD}
<p style="text-align: center"><strong>INTERVIEW SHORTLIST SUBMITTED FOR EXCO APPROVAL</strong></p>
<p><strong>{{jobTitle}}</strong> ({{jobRef}}) - {{department}}<br>Positions: {{positionsRequired}} &middot; Duty station: {{dutyStation}} &middot; Salary scale: {{salaryScale}}</p>
{{shortlistTable}}
<p>EXCO minute: ______________________ &nbsp; Date: ______________</p>
<table>
<tbody>
<tr><td>Prepared by (HR)<br><br><br></td><td>Director Human Resource &amp; Administration<br><br><br></td><td>Chairperson, EXCO<br><br><br></td></tr>
</tbody>
</table>
<p>{{date}}</p>`
  },

  // Emails HR sends to many candidates at once (bulkEmailController,
  // FR-ATS-050). `kind: 'email'` - HR can still change the subject and
  // wording for one send; each copy is filled with that candidate's details.
  emailRegret: {
    kind: 'email',
    name: 'Email: not successful',
    description: 'Sent in bulk to candidates whose applications did not go further.',
    subject: 'Your application for {{jobTitle}} ({{jobRef}})',
    placeholders: EMAIL,
    body: `<p>Dear {{candidateName}},</p>
<p>Thank you for applying for the position of <strong>{{jobTitle}}</strong> ({{jobRef}}) at the Uganda Civil Aviation Authority.</p>
<p>We regret to inform you that your application was not successful on this occasion. We received many strong applications and the selection was competitive.</p>
<p>We encourage you to apply for future vacancies that match your qualifications and experience.</p>
<p>Yours sincerely,<br>UCAA Human Resources</p>`
  },
  emailScreeningInvitation: {
    kind: 'email',
    name: 'Email: invitation to an assessment',
    description: 'Invites candidates to a screening test, aptitude test or document check - fill in the details before sending.',
    subject: 'Invitation - {{jobTitle}} ({{jobRef}})',
    placeholders: EMAIL,
    body: `<p>Dear {{candidateName}},</p>
<p>Thank you for your application for the position of <strong>{{jobTitle}}</strong> ({{jobRef}}).</p>
<p>You are invited to [describe the assessment] on [date] at [time], at [venue]. Please bring your National ID and the originals of your academic documents.</p>
<p>Please confirm your attendance by replying to this email.</p>
<p>Yours sincerely,<br>UCAA Human Resources</p>`
  },
  emailGeneral: {
    kind: 'email',
    name: 'Email: general update',
    description: 'A plain message to the selected candidates - write it before sending.',
    subject: 'Update on your application - {{jobRef}}',
    placeholders: EMAIL,
    body: `<p>Dear {{candidateName}},</p>
<p>[Your message]</p>
<p>Yours sincerely,<br>UCAA Human Resources</p>`
  }
};

module.exports = { DEFAULTS };
