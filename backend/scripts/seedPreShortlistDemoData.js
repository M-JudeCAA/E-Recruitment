// One-off demo-data seeder for manually exercising every Vacancy/Application
// workflow step UP TO (not including) HR's shortlist-ranking step:
// vacancy create -> approve, candidate register -> confirm -> complete
// profile -> submit an application, HR's Begin Review (screening). Stops
// right there, deliberately, so the resulting UnderReview applications are
// ready to shortlist by hand in the UI rather than already shortlisted.
//
// Drives the REAL running API (not raw DB writes) so every business rule
// along the way actually runs - the one exception is reading the
// EmailConfirmation token straight out of VerificationToken, since there's
// no dev-mode bypass and this script has no inbox to receive the real email
// from (see candidateAuthController.register/tokenService.js).
//
// Usage: start the backend (`npm run dev`) in one terminal, then in another:
//   node scripts/seedPreShortlistDemoData.js
//
// Creates 2 vacancies (one External, one Internal - both reusing the
// existing "Air Traffic Management Officer - trainnee" position, id 18,
// under the already-Approved ATM/DANS department) and 3 candidates: one
// whose profile should pass screening, one that should fail it, and one
// Internal candidate left un-verified (Pending) so HR verification is
// something left to do by hand, not pre-seeded away.
const prisma = require('../src/config/db');

const BASE = process.env.API_BASE || 'http://localhost:4000';
const STAMP = Date.now();
// nationalId must match NATIONAL_ID_RE = /^C[FM]\d{2}[A-Za-z0-9]{10}$/ exactly
// (see profileCompleteness.js) - a 2-digit zero-padded suffix keeps every
// generated id exactly 14 characters regardless of what Date.now() % 100
// happens to be at run time.
const STAMP_2 = String(STAMP % 100).padStart(2, '0');
const PASSWORD = 'DemoPass123!';
const POSITION_ID = 18; // Air Traffic Management Officer - trainnee, dept 37 (ATM/DANS), already Approved

async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (form) {
    body = form; // fetch sets the multipart boundary header itself for a FormData body
  } else if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function staffLogin(email) {
  const r = await api('POST', '/api/staff/auth/login', { json: { email, password: 'ChangeMe123!' } });
  return r.token;
}

// Reads the plaintext EmailConfirmation token straight from the DB - the
// same thing a real confirmation email would have linked to.
async function readConfirmationToken(email) {
  const t = await prisma.verificationToken.findFirst({
    where: { type: 'EmailConfirmation', pendingRegistration: { email } },
    orderBy: { createdAt: 'desc' }
  });
  if (!t) throw new Error(`No EmailConfirmation token found for ${email}`);
  return t.token;
}

async function registerAndConfirm({ fullName, email, nationalId }) {
  await api('POST', '/api/candidates/auth/register', { json: { fullName, email, password: PASSWORD, nationalId } });
  const token = await readConfirmationToken(email);
  await api('GET', `/api/candidates/auth/confirm-email?token=${encodeURIComponent(token)}`);
  const { token: authToken } = await api('POST', '/api/candidates/auth/login', { json: { email, password: PASSWORD } });
  return authToken;
}

async function completeExternalProfile(candidateToken, { nationalId, education, workExperience }) {
  await api('PUT', '/api/candidates/me', {
    token: candidateToken,
    json: { nationalId, idType: 'NationalID', location: 'Kampala, Uganda', workAuthorization: 'Yes' }
  });
  await api('POST', '/api/candidates/me/education', { token: candidateToken, json: education });
  await api('POST', '/api/candidates/me/work-experience', { token: candidateToken, json: workExperience });
}

async function completeInternalProfile(candidateToken, { nationalId, education, workExperience, internalProfile }) {
  await completeExternalProfile(candidateToken, { nationalId, education, workExperience });
  await api('PUT', '/api/candidates/me/internal-profile', { token: candidateToken, json: internalProfile });
}

function refereesForm() {
  return JSON.stringify([
    { name: 'Grace Nakato', relationship: 'Former Supervisor', organization: 'Uganda Airlines', phone: '0700111222', email: 'grace.nakato@example.com' },
    { name: 'Peter Okello', relationship: 'Colleague', organization: 'Entebbe ATC', phone: '0700333444', email: 'peter.okello@example.com' },
    { name: 'Sarah Mbabazi', relationship: 'Academic Referee', organization: 'Makerere University', phone: '0700555666', email: 'sarah.mbabazi@example.com' }
  ]);
}

async function submitApplication(candidateToken, { vacancyId, desirableResponses, disqualifyingResponses }) {
  const draftForm = new FormData();
  draftForm.append('vacancyId', String(vacancyId));
  draftForm.append('desiredSalary', 'Negotiable');
  draftForm.append('openToRelocate', 'Yes');
  draftForm.append('earliestStartDate', new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  draftForm.append('whyThisRole', 'Seeded demo application for exercising the pre-shortlist review workflow.');
  draftForm.append('desirableResponses', JSON.stringify(desirableResponses));
  draftForm.append('disqualifyingResponses', JSON.stringify(disqualifyingResponses));
  draftForm.append('referees', refereesForm());
  const draft = await api('POST', '/api/applications', { token: candidateToken, form: draftForm });
  const submitted = await api('PATCH', `/api/applications/${draft.id}/submit`, { token: candidateToken });
  return submitted;
}

async function main() {
  console.log(`Seeding demo data (stamp ${STAMP}) against ${BASE} ...`);

  const hroToken = await staffLogin('hro@caa.co.ug');
  const managerToken = await staffLogin('manager@caa.co.ug'); // approver - must differ from creator (self-approval is blocked)
  const shroToken = await staffLogin('shro@caa.co.ug'); // Senior_HR_Officer+ - can run Begin Review

  const deadline = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  console.log('\nCreating External vacancy...');
  const extVacancy = await api('POST', '/api/vacancies', {
    token: hroToken,
    json: {
      positionId: POSITION_ID,
      postingType: 'External',
      positionsRequired: 2,
      deadline,
      employmentCategory: 'FullTime',
      location: 'Entebbe International Airport',
      minimumEducationLevel: 'Bachelors',
      minimumExperienceYears: 2,
      minimumCGPA: 3.0,
      essentialRequirements: [
        "Bachelor's degree in Air Traffic Management or a related field",
        'At least 2 years of relevant aviation experience'
      ],
      desirableRequirements: [
        { text: 'Willing to work night shifts and weekends', answerType: 'yesno' },
        { text: 'Minimum flying hours logged', answerType: 'number', minValue: 50 }
      ],
      disqualifyingRequirements: [
        { text: 'Are you willing to relocate to Entebbe if required?', requiredAnswer: 'Yes' }
      ]
    }
  });
  console.log(`  Vacancy ${extVacancy.id} (${extVacancy.jobRef}) - PendingApproval`);

  console.log('Creating Internal vacancy...');
  const intVacancy = await api('POST', '/api/vacancies', {
    token: hroToken,
    json: {
      positionId: POSITION_ID,
      postingType: 'Internal',
      positionsRequired: 1,
      deadline,
      employmentCategory: 'FullTime',
      location: 'Entebbe International Airport',
      minimumEducationLevel: 'Diploma',
      minimumExperienceYears: 1,
      essentialRequirements: [
        'Diploma in a relevant field',
        'At least 1 year of internal UCAA experience'
      ],
      desirableRequirements: [
        { text: 'Familiar with UCAA internal SOPs', answerType: 'yesno' }
      ],
      disqualifyingRequirements: [
        { text: "Do you have your supervisor's endorsement to apply?", requiredAnswer: 'Yes' }
      ]
    }
  });
  console.log(`  Vacancy ${intVacancy.id} (${intVacancy.jobRef}) - PendingApproval`);

  console.log('\nApproving both vacancies as manager@caa.co.ug...');
  await api('PATCH', `/api/vacancies/${extVacancy.id}/approve`, { token: managerToken });
  await api('PATCH', `/api/vacancies/${intVacancy.id}/approve`, { token: managerToken });
  console.log('  Both vacancies now Open.');

  const extDesirableIds = extVacancy.desirableRequirements.map((r) => r.id);
  const extDisqualifyingIds = extVacancy.disqualifyingRequirements.map((r) => r.id);
  const intDesirableIds = intVacancy.desirableRequirements.map((r) => r.id);
  const intDisqualifyingIds = intVacancy.disqualifyingRequirements.map((r) => r.id);

  console.log('\nRegistering External candidate expected to PASS screening...');
  const passEmail = `demo.pass.${STAMP}@example.com`;
  const passToken = await registerAndConfirm({ fullName: 'Alice Among', email: passEmail, nationalId: `CF01AB12CD${STAMP_2}AB` });
  await completeExternalProfile(passToken, {
    nationalId: `CF01AB12CD${STAMP_2}AB`,
    education: { institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Air Traffic Management', yearCompleted: 2019, cgpa: 3.6 },
    workExperience: { employer: 'Uganda Airlines', jobTitle: 'Ramp Controller', startDate: '2020-01-15' } // ~ongoing, well over 2 years
  });
  const passApp = await submitApplication(passToken, {
    vacancyId: extVacancy.id,
    desirableResponses: [
      { id: extDesirableIds[0], answer: true },
      { id: extDesirableIds[1], answer: 120 }
    ],
    disqualifyingResponses: [{ id: extDisqualifyingIds[0], answer: true }]
  });
  console.log(`  ${passEmail} -> application ${passApp.id} (Submitted)`);

  console.log('Registering External candidate expected to FAIL screening...');
  const failEmail = `demo.fail.${STAMP}@example.com`;
  const failToken = await registerAndConfirm({ fullName: 'Brian Ochen', email: failEmail, nationalId: `CM02CD34EF${STAMP_2}CD` });
  await completeExternalProfile(failToken, {
    nationalId: `CM02CD34EF${STAMP_2}CD`,
    education: { institution: 'Kyambogo University', qualificationLevel: 'Bachelors', fieldOfStudy: 'General Studies', yearCompleted: 2024, cgpa: 2.4 },
    workExperience: { employer: 'Local Aviation Ltd', jobTitle: 'Trainee', startDate: new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10) } // ~6 months, under the 2yr minimum
  });
  const failApp = await submitApplication(failToken, {
    vacancyId: extVacancy.id,
    desirableResponses: [
      { id: extDesirableIds[0], answer: false },
      { id: extDesirableIds[1], answer: 5 }
    ],
    disqualifyingResponses: [{ id: extDisqualifyingIds[0], answer: false }] // answers "No" to a required-"Yes" gate
  });
  console.log(`  ${failEmail} -> application ${failApp.id} (Submitted)`);

  console.log('Registering Internal candidate (left un-verified for HR to act on)...');
  const internalEmail = `demo.internal.${STAMP}@caa.co.ug`;
  const internalToken = await registerAndConfirm({ fullName: 'Carol Namutebi', email: internalEmail, nationalId: `CF03EF56GH${STAMP_2}EF` });
  await completeInternalProfile(internalToken, {
    nationalId: `CF03EF56GH${STAMP_2}EF`,
    education: { institution: 'Uganda Aviation Training School', qualificationLevel: 'Diploma', fieldOfStudy: 'Air Traffic Services', yearCompleted: 2021 },
    workExperience: { employer: 'UCAA', jobTitle: 'Assistant ATC Officer', startDate: '2022-03-01' },
    internalProfile: {
      employeeId: `EMP-${STAMP}`,
      department: 'ATM',
      position: 'Assistant ATC Officer',
      dateJoined: '2022-03-01',
      supervisorName: 'James Kato',
      supervisorEmail: 'james.kato@caa.co.ug'
    }
  });
  const internalApp = await submitApplication(internalToken, {
    vacancyId: intVacancy.id,
    desirableResponses: [{ id: intDesirableIds[0], answer: true }],
    disqualifyingResponses: [{ id: intDisqualifyingIds[0], answer: true }]
  });
  console.log(`  ${internalEmail} -> application ${internalApp.id} (Submitted) - InternalProfile.verificationStatus left Pending`);

  console.log('\nRunning Begin Review on both vacancies as shro@caa.co.ug (screens every Submitted application)...');
  const extReview = await api('PATCH', `/api/vacancies/${extVacancy.id}/begin-review`, { token: shroToken });
  const intReview = await api('PATCH', `/api/vacancies/${intVacancy.id}/begin-review`, { token: shroToken });
  console.log(`  External vacancy: screened ${extReview.screened} application(s).`);
  console.log(`  Internal vacancy: screened ${intReview.screened} application(s).`);

  console.log('\n=== Done. Ready for HR to review/shortlist by hand. ===');
  console.log(`External vacancy: /hr/applications?vacancyId=${extVacancy.id}  (${extVacancy.jobRef})`);
  console.log(`Internal vacancy: /hr/applications?vacancyId=${intVacancy.id}  (${intVacancy.jobRef})`);
  console.log(`\nCandidate logins (password for all: ${PASSWORD}):`);
  console.log(`  ${passEmail}      - expect screeningPassed: true`);
  console.log(`  ${failEmail}      - expect screeningPassed: false (flagged)`);
  console.log(`  ${internalEmail} - Internal, InternalProfile still Pending verification`);
}

main()
  .catch((e) => { console.error('\nSEED FAILED:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
