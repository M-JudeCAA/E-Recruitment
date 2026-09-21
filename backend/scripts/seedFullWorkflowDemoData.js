// One-off demo-data seeder that exercises EVERY major workflow in the
// system end-to-end, for presentation purposes - unlike
// seedPreShortlistDemoData.js (which deliberately stops at UnderReview so
// HR can shortlist by hand), this one drives applications all the way
// through shortlist propose/approve, interview scheduling/scoring/
// finalizing (all three recommendation outcomes), offer recommend/approve/
// accept/decline (including the reserve-promotion cascade), vacancy status
// computation (Open/PartiallyFilled/Filled/Closed), internal-candidate
// verification (all three outcomes), department/position creation, and
// delegation - while deliberately leaving a few things un-actioned
// (one PendingApproval vacancy, one ShortlistProposed vacancy, one Pending
// department) so the presenter has real, live actions left to perform on
// stage rather than a system that already looks "finished".
//
// Drives the REAL running API (not raw DB writes), same principle as
// seedPreShortlistDemoData.js - every business rule actually runs. Direct
// DB reads are used only where the API genuinely has no read path back
// (email confirmation tokens, panel member ids after scheduling), exactly
// as that script already does.
//
// Usage: start the backend (`npm run dev`) in one terminal, then in another:
//   node scripts/seedFullWorkflowDemoData.js
//
// Reuses the 5 vacancies already open+empty in this DB (ids 33/38/49/56/57)
// rather than multiplying vacancies pointlessly, and creates 2 new
// positions + 2 new vacancies + 1 new pending department + 1 delegation on
// top. After it finishes, run `node scripts/checkSlaEscalations.js` once to
// turn the deliberately-backdated PendingApproval vacancy into a real SLA
// escalation + notification.
const prisma = require('../src/config/db');

const BASE = process.env.API_BASE || 'http://localhost:4000';
const STAMP = Date.now();
const STAMP_36 = STAMP.toString(36).toUpperCase().padStart(6, '0').slice(-6);
const PASSWORD = 'DemoPass123!';

// nationalId must match /^C[FM]\d{2}[A-Za-z0-9]{10}$/ exactly (14 chars
// total) - see profileCompleteness.js. `i` just needs to be unique per
// candidate in this run.
let nidCounter = 0;
function nextNationalId(sex) {
  nidCounter += 1;
  return `C${sex}${String(nidCounter).padStart(2, '0')}${STAMP_36}${String(nidCounter).padStart(4, '0')}`;
}

async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (form) {
    body = form;
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

async function createDraft(candidateToken, { vacancyId, desirableResponses, disqualifyingResponses }) {
  const draftForm = new FormData();
  draftForm.append('vacancyId', String(vacancyId));
  draftForm.append('desiredSalary', 'Negotiable');
  draftForm.append('openToRelocate', 'Yes');
  draftForm.append('earliestStartDate', new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  draftForm.append('whyThisRole', 'Seeded demo application for exercising the full recruitment workflow.');
  draftForm.append('desirableResponses', JSON.stringify(desirableResponses || []));
  draftForm.append('disqualifyingResponses', JSON.stringify(disqualifyingResponses || []));
  draftForm.append('referees', refereesForm());
  return api('POST', '/api/applications', { token: candidateToken, form: draftForm });
}

async function submitApplication(candidateToken, opts) {
  const draft = await createDraft(candidateToken, opts);
  return api('PATCH', `/api/applications/${draft.id}/submit`, { token: candidateToken });
}

// --- New helpers beyond seedPreShortlistDemoData.js ---

async function findDepartmentByName(token, name) {
  const departments = await api('GET', '/api/departments/approved', { token });
  const match = departments.find((d) => d.name === name);
  if (!match) throw new Error(`Department "${name}" not found among approved departments`);
  return match;
}

async function findDirectorateByName(token, name) {
  const directorates = await api('GET', '/api/directorates', { token });
  const match = directorates.find((d) => d.name === name);
  if (!match) throw new Error(`Directorate "${name}" not found`);
  return match;
}

async function createPosition(token, { name, departmentId, level }) {
  return api('POST', '/api/positions', { token, json: { name, departmentId, level } });
}

async function verifyInternal(token, candidateId, decision, comments) {
  const form = new FormData();
  form.append('decision', decision);
  form.append('comments', comments);
  return api('PATCH', `/api/verification/candidates/${candidateId}/verify`, { token, form });
}

// Bulk-ranks a vacancy's applications in the given order (Primary/Reserve
// computed server-side from positionsRequired) - lands every one at
// ShortlistProposed, same as dragging the ranking UI and clicking "Save
// ranking & propose shortlist". Fresh applications default to
// rankVersion 0, so no read-back is needed before this first ranking.
async function proposeShortlistRanking(token, vacancyId, applicationIds) {
  const applicationRankVersions = Object.fromEntries(applicationIds.map((id) => [id, 0]));
  return api('POST', `/api/vacancies/${vacancyId}/rank`, { token, json: { applicationIds, applicationRankVersions } });
}

async function approveShortlist(token, vacancyId) {
  return api('POST', `/api/applications/vacancies/${vacancyId}/approve-shortlist`, { token });
}

async function scheduleInterview(token, applicationId, { scheduledDate, mode, panelMembers }) {
  const round = await api('POST', `/api/interviews/applications/${applicationId}/interviews`, {
    token, json: { scheduledDate, mode, panelMembers }
  });
  // schedule()'s response is the bare InterviewRound row (no nested
  // panelMembers include) - read them back directly, same "no API read
  // path back" exception as readConfirmationToken above.
  const members = await prisma.panelMember.findMany({ where: { interviewRoundId: round.id } });
  return { round, members };
}

async function scorePanelMember(token, panelMemberId, score, comments) {
  return api('PATCH', `/api/interviews/panel-members/${panelMemberId}/score`, { token, json: { score, comments } });
}

async function finalizeInterview(token, interviewId, recommendation) {
  return api('PATCH', `/api/interviews/${interviewId}/finalize`, { token, json: { recommendation } });
}

async function recommendOffer(token, applicationId) {
  return api('POST', `/api/applications/${applicationId}/recommend-offer`, { token });
}

async function approveOffer(token, offerId) {
  return api('PATCH', `/api/applications/offers/${offerId}/approve`, { token });
}

async function acceptOffer(candidateToken, offerId) {
  return api('PATCH', `/api/applications/offers/${offerId}/accept`, { token: candidateToken });
}

async function declineOffer(candidateToken, offerId) {
  return api('PATCH', `/api/applications/offers/${offerId}/decline`, { token: candidateToken });
}

// Standard set of interview-ready candidates: shortlist-proposes every
// application id in `order` for the vacancy, approves it as a different
// PHRO than the proposer (self-approval would otherwise block it), then
// schedules+scores+finalizes an interview for each with the given
// recommendation, in order.
async function runInterviewPipeline(tokens, vacancyId, entries) {
  const { hro, phro, shro } = tokens;
  await proposeShortlistRanking(shro, vacancyId, entries.map((e) => e.applicationId));
  await approveShortlist(phro, vacancyId);

  for (const entry of entries) {
    const { round, members } = await scheduleInterview(shro, entry.applicationId, {
      scheduledDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      mode: entry.mode || 'In-person',
      panelMembers: [
        { name: 'Capt. Ronald Ssemwogerere', trade: 'Panel Chair', email: 'ronald.ssemwogerere@caa.co.ug' },
        { name: 'Diana Kyeyune', trade: 'HR Panelist', email: 'diana.kyeyune@caa.co.ug' }
      ]
    });
    await scorePanelMember(shro, members[0].id, entry.scores[0], 'Strong technical knowledge, confident delivery.');
    await scorePanelMember(shro, members[1].id, entry.scores[1], 'Good cultural fit, clear communication.');
    await finalizeInterview(shro, round.id, entry.recommendation);
    entry.interviewId = round.id;
  }
}

async function main() {
  console.log(`Seeding full-workflow demo data (stamp ${STAMP}) against ${BASE} ...\n`);

  const tokens = {
    hro: await staffLogin('hro@caa.co.ug'),
    shro: await staffLogin('shro@caa.co.ug'),
    phro: await staffLogin('phro@caa.co.ug'),
    manager: await staffLogin('manager@caa.co.ug'),
    dhra: await staffLogin('dhra@caa.co.ug')
  };
  const deadline = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  // ===================================================================
  // PHASE 1 - Org structure: two new positions, one new pending department
  // ===================================================================
  console.log('=== Phase 1: Org structure ===');
  const financeDept = await findDepartmentByName(tokens.hro, 'FINANCE');
  const avsecDept = await findDepartmentByName(tokens.hro, 'AVSEC');
  const financeOfficerPosition = await createPosition(tokens.hro, { name: `Finance Officer (${STAMP})`, departmentId: financeDept.id, level: 2 });
  const avsecOfficerPosition = await createPosition(tokens.hro, { name: `Aviation Security Officer (${STAMP})`, departmentId: avsecDept.id, level: 1 });
  console.log(`  Created position "${financeOfficerPosition.name}" (id ${financeOfficerPosition.id}) under FINANCE`);
  console.log(`  Created position "${avsecOfficerPosition.name}" (id ${avsecOfficerPosition.id}) under AVSEC`);

  const dsserDirectorate = await findDirectorateByName(tokens.hro, 'DSSER');
  const pendingDept = await api('POST', '/api/departments', {
    token: tokens.hro, json: { name: `SMS (${STAMP})`, directorateId: dsserDirectorate.id }
  });
  console.log(`  Proposed department "${pendingDept.name}" (id ${pendingDept.id}) under DSSER - LEFT Pending for live approval.`);

  // One self-service delegation record - Principal HR Officer delegating
  // to Senior HR Officer, exercising delegationController end to end.
  const staffDirectory = await api('GET', '/api/staff-users', { token: tokens.phro });
  const shroStaff = staffDirectory.find((s) => s.email === 'shro@caa.co.ug');
  const delegation = await api('POST', '/api/delegations', {
    token: tokens.phro,
    json: {
      delegateId: shroStaff.id,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      reason: 'Covering PHRO shortlist-approval duties during scheduled leave.'
    }
  });
  console.log(`  Created delegation ${delegation.id}: Principal HR Officer -> Senior HR Officer, 7 days.\n`);

  // ===================================================================
  // PHASE 2 - Vacancies: one new PendingApproval (left un-actioned + SLA
  // demo), one new approved vacancy for the interview-outcomes demo,
  // plus the 5 already-open-and-empty vacancies in this DB reused below.
  // ===================================================================
  console.log('=== Phase 2: Vacancies ===');

  const pendingApprovalVacancy = await api('POST', '/api/vacancies', {
    token: tokens.hro,
    json: {
      positionId: financeOfficerPosition.id,
      postingType: 'External',
      positionsRequired: 1,
      deadline,
      employmentCategory: 'FullTime',
      location: 'Kampala Head Office',
      minimumEducationLevel: 'Bachelors',
      minimumExperienceYears: 2,
      essentialRequirements: ["Bachelor's degree in Finance, Accounting or a related field", 'At least 2 years of relevant experience'],
      desirableRequirements: [{ text: 'CPA or ACCA part-qualified', answerType: 'yesno' }],
      disqualifyingRequirements: [{ text: 'Are you willing to relocate to Kampala if required?', requiredAnswer: 'Yes' }]
    }
  });
  console.log(`  Vacancy ${pendingApprovalVacancy.id} (${pendingApprovalVacancy.jobRef}) - PendingApproval, LEFT for live approval demo.`);
  // Backdated well past the 48h VacancyApproval SLA policy so
  // `node scripts/checkSlaEscalations.js` (run separately, after this
  // script) turns this into a real escalation + notification.
  await prisma.vacancy.update({ where: { id: pendingApprovalVacancy.id }, data: { createdAt: new Date(Date.now() - 60 * 3600000) } });
  console.log('    (createdAt backdated 60h for the SLA escalation demo)');

  const avsecVacancy = await api('POST', '/api/vacancies', {
    token: tokens.hro,
    json: {
      positionId: avsecOfficerPosition.id,
      postingType: 'External',
      positionsRequired: 1,
      deadline,
      employmentCategory: 'FullTime',
      location: 'Entebbe International Airport',
      minimumEducationLevel: 'Bachelors',
      minimumExperienceYears: 1,
      essentialRequirements: ["Bachelor's degree or equivalent", 'At least 1 year of relevant aviation security experience'],
      desirableRequirements: [{ text: 'Holds a valid AVSEC certification', answerType: 'yesno' }],
      disqualifyingRequirements: [{ text: 'Are you willing to work rotating shifts?', requiredAnswer: 'Yes' }]
    }
  });
  await api('PATCH', `/api/vacancies/${avsecVacancy.id}/approve`, { token: tokens.manager });
  console.log(`  Vacancy ${avsecVacancy.id} (${avsecVacancy.jobRef}) - approved, Open. Will carry all 3 interview outcomes.`);

  const v49 = await api('GET', `/api/vacancies/49`); // ATM trainee, External, fresh/empty queue demo
  const v57 = await api('GET', `/api/vacancies/57`); // ATM trainee, Internal, ShortlistProposed gate demo
  const v56 = await api('GET', `/api/vacancies/56`); // ATM trainee, External x2, full offer lifecycle + decline cascade
  const v33 = await api('GET', `/api/vacancies/33`); // IT Support Officer, External x1, Filled demo
  const v38 = await api('GET', `/api/vacancies/38`); // ATM trainee, External x1, Closed demo
  console.log(`  Reusing existing open vacancies: ${v49.jobRef} (fresh queue), ${v57.jobRef} (shortlist gate), ${v56.jobRef} (offer lifecycle), ${v33.jobRef} (filled), ${v38.jobRef} (closed).\n`);

  const idOf = (reqs) => (reqs || []).map((r) => r.id);
  // Null-safe: some reused vacancies predate desirableRequirements/
  // disqualifyingRequirements defaulting to [] and still have it stored as
  // null (e.g. vacancy 33) - guards every submitApplication call below.
  const firstResponse = (reqs, answer) => (idOf(reqs).length ? [{ id: idOf(reqs)[0], answer }] : []);

  // ===================================================================
  // PHASE 3 - Vacancy 49 gets a fresh external queue (Draft + Submitted).
  // The two internal candidates below apply to vacancy 57 instead
  // (Internal posting type only), sitting unranked alongside Phase 4's
  // David/Esther, with different verification states.
  // ===================================================================
  console.log('=== Phase 3: Fresh queue on vacancy 49 + unranked internal applicants on vacancy 57 ===');
  const oscarNid = nextNationalId('M');
  const draftOnlyToken = await registerAndConfirm({ fullName: 'Oscar Wandera', email: `demo.oscar.${STAMP}@example.com`, nationalId: oscarNid });
  await completeExternalProfile(draftOnlyToken, {
    nationalId: oscarNid,
    education: { institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Aviation Management', yearCompleted: 2021, cgpa: 3.2 },
    workExperience: { employer: 'Kampala Airport Services', jobTitle: 'Operations Assistant', startDate: '2022-01-01' }
  });
  await createDraft(draftOnlyToken, { vacancyId: v49.id, desirableResponses: [], disqualifyingResponses: [] });
  console.log('  Oscar Wandera - Draft only (never submitted)');

  const patriciaNid = nextNationalId('F');
  const submittedExtToken = await registerAndConfirm({ fullName: 'Patricia Namono', email: `demo.patricia.${STAMP}@example.com`, nationalId: patriciaNid });
  await completeExternalProfile(submittedExtToken, {
    nationalId: patriciaNid,
    education: { institution: 'Kyambogo University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Air Traffic Management', yearCompleted: 2020, cgpa: 3.4 },
    workExperience: { employer: 'Entebbe ATC', jobTitle: 'Trainee Controller', startDate: '2021-06-01' }
  });
  await submitApplication(submittedExtToken, {
    vacancyId: v49.id,
    desirableResponses: firstResponse(v49.desirableRequirements, true),
    disqualifyingResponses: firstResponse(v49.disqualifyingRequirements, true)
  });
  console.log('  Patricia Namono - Submitted (external, not yet reviewed)');

  const quinnNid = nextNationalId('M');
  const pendingVerificationToken = await registerAndConfirm({ fullName: 'Quinn Ateenyi', email: `demo.quinn.${STAMP}@caa.co.ug`, nationalId: quinnNid });
  await completeInternalProfile(pendingVerificationToken, {
    nationalId: quinnNid,
    education: { institution: 'Uganda Aviation Training School', qualificationLevel: 'Diploma', fieldOfStudy: 'Air Traffic Services', yearCompleted: 2020 },
    workExperience: { employer: 'UCAA', jobTitle: 'Assistant ATC Officer', startDate: '2021-02-01' },
    internalProfile: { employeeId: `EMP-Q-${STAMP}`, department: 'ATM', position: 'Assistant ATC Officer', dateJoined: '2021-02-01', supervisorName: 'James Kato', supervisorEmail: 'james.kato@caa.co.ug' }
  });
  // Internal candidates can't apply to an External-only vacancy (see
  // applicationEligibility.js) - v49 is External, so these two apply to
  // v57 (Internal) instead, alongside Phase 4's ranked David/Esther, as
  // unranked Submitted applicants HR hasn't gotten to yet.
  await submitApplication(pendingVerificationToken, {
    vacancyId: v57.id,
    desirableResponses: firstResponse(v57.desirableRequirements, true),
    disqualifyingResponses: firstResponse(v57.disqualifyingRequirements, true)
  });
  console.log('  Quinn Ateenyi - Submitted (internal, on vacancy 57, verification left Pending)');

  const rachelNid = nextNationalId('F');
  const discrepancyToken = await registerAndConfirm({ fullName: 'Rachel Nabatanzi', email: `demo.rachel.${STAMP}@caa.co.ug`, nationalId: rachelNid });
  await completeInternalProfile(discrepancyToken, {
    nationalId: rachelNid,
    education: { institution: 'Uganda Aviation Training School', qualificationLevel: 'Diploma', fieldOfStudy: 'Air Traffic Services', yearCompleted: 2019 },
    workExperience: { employer: 'UCAA', jobTitle: 'Ramp Officer', startDate: '2020-05-01' },
    internalProfile: { employeeId: `EMP-R-${STAMP}`, department: 'ATM', position: 'Ramp Officer', dateJoined: '2020-05-01', supervisorName: 'James Kato', supervisorEmail: 'james.kato@caa.co.ug' }
  });
  const rachelApp = await submitApplication(discrepancyToken, {
    vacancyId: v57.id,
    desirableResponses: firstResponse(v57.desirableRequirements, true),
    disqualifyingResponses: firstResponse(v57.disqualifyingRequirements, true)
  });
  await verifyInternal(tokens.shro, rachelApp.candidateId, 'Discrepancy_Flagged', 'Declared job title does not match the employee record on file - referred back to supervisor for clarification.');
  console.log('  Rachel Nabatanzi - Submitted (internal, on vacancy 57, verification Discrepancy_Flagged)\n');

  // ===================================================================
  // PHASE 4 - Vacancy 57 (Internal): ShortlistProposed gate demo, left
  // for live approval by a Principal HR Officer.
  // ===================================================================
  console.log('=== Phase 4: Shortlist-approval gate demo on vacancy 57 (Internal) ===');
  const davidNid = nextNationalId('M');
  const davidToken = await registerAndConfirm({ fullName: 'David Ssekandi', email: `demo.david.${STAMP}@caa.co.ug`, nationalId: davidNid });
  await completeInternalProfile(davidToken, {
    nationalId: davidNid,
    education: { institution: 'Uganda Aviation Training School', qualificationLevel: 'Diploma', fieldOfStudy: 'Air Traffic Services', yearCompleted: 2018 },
    workExperience: { employer: 'UCAA', jobTitle: 'Senior Assistant ATC Officer', startDate: '2019-03-01' },
    internalProfile: { employeeId: `EMP-D-${STAMP}`, department: 'ATM', position: 'Senior Assistant ATC Officer', dateJoined: '2019-03-01', supervisorName: 'James Kato', supervisorEmail: 'james.kato@caa.co.ug' }
  });
  const davidApp = await submitApplication(davidToken, {
    vacancyId: v57.id,
    desirableResponses: firstResponse(v57.desirableRequirements, true),
    disqualifyingResponses: firstResponse(v57.disqualifyingRequirements, true)
  });
  await verifyInternal(tokens.shro, davidApp.candidateId, 'HR_Verified', 'Confirmed active UCAA employment and tenure directly with ATM department records.');

  const estherNid = nextNationalId('F');
  const estherToken = await registerAndConfirm({ fullName: 'Esther Auma', email: `demo.esther.${STAMP}@caa.co.ug`, nationalId: estherNid });
  await completeInternalProfile(estherToken, {
    nationalId: estherNid,
    education: { institution: 'Uganda Aviation Training School', qualificationLevel: 'Diploma', fieldOfStudy: 'Air Traffic Services', yearCompleted: 2020 },
    workExperience: { employer: 'UCAA', jobTitle: 'Assistant ATC Officer', startDate: '2021-01-01' },
    internalProfile: { employeeId: `EMP-E-${STAMP}`, department: 'ATM', position: 'Assistant ATC Officer', dateJoined: '2021-01-01', supervisorName: 'James Kato', supervisorEmail: 'james.kato@caa.co.ug' }
  });
  const estherApp = await submitApplication(estherToken, {
    vacancyId: v57.id,
    desirableResponses: firstResponse(v57.desirableRequirements, true),
    disqualifyingResponses: firstResponse(v57.disqualifyingRequirements, true)
  });
  await verifyInternal(tokens.shro, estherApp.candidateId, 'HR_Verified', 'Confirmed active UCAA employment and tenure directly with ATM department records.');

  await api('PATCH', `/api/vacancies/${v57.id}/begin-review`, { token: tokens.shro });
  await proposeShortlistRanking(tokens.shro, v57.id, [davidApp.id, estherApp.id]);
  console.log('  David Ssekandi (Primary) + Esther Auma (Reserve) -> ShortlistProposed, LEFT for live Principal HR Officer approval.\n');

  // ===================================================================
  // PHASE 5 - AVSEC vacancy: all three interview recommendation outcomes
  // ===================================================================
  console.log('=== Phase 5: Interview outcomes demo on the AVSEC vacancy ===');
  async function externalAvsecCandidate(fullName, emailSlug) {
    const nid = nextNationalId(fullName.includes('Grace') ? 'F' : 'M');
    const token = await registerAndConfirm({ fullName, email: `demo.${emailSlug}.${STAMP}@example.com`, nationalId: nid });
    await completeExternalProfile(token, {
      nationalId: nid,
      education: { institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Security Studies', yearCompleted: 2019, cgpa: 3.5 },
      workExperience: { employer: 'Entebbe Airport Security', jobTitle: 'Security Officer', startDate: '2020-01-01' }
    });
    const app = await submitApplication(token, {
      vacancyId: avsecVacancy.id,
      desirableResponses: firstResponse(avsecVacancy.desirableRequirements, true),
      disqualifyingResponses: firstResponse(avsecVacancy.disqualifyingRequirements, true)
    });
    return { token, app };
  }

  const frank = await externalAvsecCandidate('Frank Mugisha', 'frank');
  const grace = await externalAvsecCandidate('Grace Nabirye', 'grace');
  const henry = await externalAvsecCandidate('Henry Tumusiime', 'henry');
  await api('PATCH', `/api/vacancies/${avsecVacancy.id}/begin-review`, { token: tokens.shro });

  const avsecEntries = [
    { applicationId: frank.app.id, scores: [88, 84], recommendation: 'Shortlist' },
    { applicationId: grace.app.id, scores: [65, 60], recommendation: 'Hold' },
    { applicationId: henry.app.id, scores: [40, 38], recommendation: 'Reject' }
  ];
  await runInterviewPipeline(tokens, avsecVacancy.id, avsecEntries);
  console.log('  Frank Mugisha  -> Interviewed, recommendation Shortlist (ready for live "Recommend for offer")');
  console.log('  Grace Nabirye  -> Interviewed, recommendation Hold (Recommend-for-offer stays disabled)');
  console.log('  Henry Tumusiime -> Rejected via panel recommendation (not explicit HR reject)\n');

  // ===================================================================
  // PHASE 6 - Vacancy 56 (2 positions): full offer lifecycle + the
  // decline -> reserve-promotion cascade.
  // ===================================================================
  console.log('=== Phase 6: Full offer lifecycle + decline cascade on vacancy 56 ===');
  async function externalAtmCandidate(fullName, emailSlug) {
    const nid = nextNationalId('M');
    const token = await registerAndConfirm({ fullName, email: `demo.${emailSlug}.${STAMP}@example.com`, nationalId: nid });
    await completeExternalProfile(token, {
      nationalId: nid,
      education: { institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Air Traffic Management', yearCompleted: 2018, cgpa: 3.7 },
      workExperience: { employer: 'Uganda Airlines', jobTitle: 'Ramp Controller', startDate: '2019-01-01' }
    });
    const app = await submitApplication(token, {
      vacancyId: v56.id,
      desirableResponses: firstResponse(v56.desirableRequirements, true),
      disqualifyingResponses: firstResponse(v56.disqualifyingRequirements, true)
    });
    return { token, app };
  }

  const irene = await externalAtmCandidate('Irene Nansubuga', 'irene');
  const joseph = await externalAtmCandidate('Joseph Okwir', 'joseph');
  const kevin = await externalAtmCandidate('Kevin Byaruhanga', 'kevin');
  await api('PATCH', `/api/vacancies/${v56.id}/begin-review`, { token: tokens.shro });

  // Ranked in order: Irene + Joseph -> Primary (positionsRequired = 2),
  // Kevin -> Reserve.
  const v56Entries = [
    { applicationId: irene.app.id, scores: [90, 87], recommendation: 'Shortlist' },
    { applicationId: joseph.app.id, scores: [82, 80], recommendation: 'Shortlist' },
    { applicationId: kevin.app.id, scores: [75, 73], recommendation: 'Shortlist' }
  ];
  await runInterviewPipeline(tokens, v56.id, v56Entries);

  const ireneOffer = await recommendOffer(tokens.phro, irene.app.id);
  await approveOffer(tokens.manager, ireneOffer.id);
  await acceptOffer(irene.token, ireneOffer.id);
  console.log('  Irene Nansubuga -> Offer Accepted (vacancy now PartiallyFilled, 1/2)');

  const josephOffer = await recommendOffer(tokens.phro, joseph.app.id);
  await approveOffer(tokens.manager, josephOffer.id);
  await declineOffer(joseph.token, josephOffer.id);
  console.log('  Joseph Okwir -> Offer Declined -> Kevin Byaruhanga auto-promoted Reserve -> Primary (still PartiallyFilled, 1/2)');
  console.log('  Kevin Byaruhanga left without an offer recommendation yet - live "Recommend for offer" candidate.\n');

  // ===================================================================
  // PHASE 7 - Vacancy 33 (IT Support Officer, 1 position): Filled demo
  // ===================================================================
  console.log('=== Phase 7: Filled vacancy demo on vacancy 33 ===');
  const lindaNid = nextNationalId('F');
  const lindaToken = await registerAndConfirm({ fullName: 'Linda Achieng', email: `demo.linda.${STAMP}@example.com`, nationalId: lindaNid });
  await completeExternalProfile(lindaToken, {
    nationalId: lindaNid,
    education: { institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Information Technology', yearCompleted: 2020, cgpa: 3.6 },
    workExperience: { employer: 'MTN Uganda', jobTitle: 'IT Support Technician', startDate: '2021-01-01' }
  });
  const lindaApp = await submitApplication(lindaToken, {
    vacancyId: v33.id,
    desirableResponses: firstResponse(v33.desirableRequirements, true),
    disqualifyingResponses: firstResponse(v33.disqualifyingRequirements, true)
  });
  await api('PATCH', `/api/vacancies/${v33.id}/begin-review`, { token: tokens.shro });
  await runInterviewPipeline(tokens, v33.id, [{ applicationId: lindaApp.id, scores: [92, 89], recommendation: 'Shortlist' }]);
  const lindaOffer = await recommendOffer(tokens.phro, lindaApp.id);
  await approveOffer(tokens.dhra, lindaOffer.id); // Director can approve too, not just Manager
  await acceptOffer(lindaToken, lindaOffer.id);
  console.log('  Linda Achieng -> Offer Accepted -> vacancy 33 now Filled (1/1), filledAt stamped.\n');

  // ===================================================================
  // PHASE 8 - Vacancy 38 (ATM trainee, 1 position): Withdrawn + explicit
  // HR-reject demo, then the vacancy itself is Closed.
  // ===================================================================
  console.log('=== Phase 8: Withdrawn + explicit reject + Closed demo on vacancy 38 ===');
  const mosesNid = nextNationalId('M');
  const mosesToken = await registerAndConfirm({ fullName: 'Moses Kyeyune', email: `demo.moses.${STAMP}@example.com`, nationalId: mosesNid });
  await completeExternalProfile(mosesToken, {
    nationalId: mosesNid,
    education: { institution: 'Kyambogo University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Aviation Studies', yearCompleted: 2021, cgpa: 3.1 },
    workExperience: { employer: 'Skyway Cargo', jobTitle: 'Logistics Officer', startDate: '2022-01-01' }
  });
  const mosesApp = await submitApplication(mosesToken, {
    vacancyId: v38.id,
    desirableResponses: firstResponse(v38.desirableRequirements, false),
    disqualifyingResponses: firstResponse(v38.disqualifyingRequirements, true)
  });
  await api('PATCH', `/api/applications/${mosesApp.id}/withdraw`, { token: mosesToken, json: { reason: 'Accepted a different offer.' } });
  console.log('  Moses Kyeyune -> Withdrawn (candidate self-service, after submitting)');

  const nancyNid = nextNationalId('F');
  const nancyToken = await registerAndConfirm({ fullName: 'Nancy Tumwine', email: `demo.nancy.${STAMP}@example.com`, nationalId: nancyNid });
  await completeExternalProfile(nancyToken, {
    nationalId: nancyNid,
    education: { institution: 'Kyambogo University', qualificationLevel: 'Certificate', fieldOfStudy: 'General Studies', yearCompleted: 2023, cgpa: 2.2 },
    workExperience: { employer: 'Local Aviation Ltd', jobTitle: 'Trainee', startDate: '2024-06-01' }
  });
  const nancyApp = await submitApplication(nancyToken, {
    vacancyId: v38.id,
    desirableResponses: firstResponse(v38.desirableRequirements, false),
    disqualifyingResponses: firstResponse(v38.disqualifyingRequirements, false)
  });
  await api('PATCH', `/api/vacancies/${v38.id}/begin-review`, { token: tokens.shro });
  await api('PATCH', `/api/applications/${nancyApp.id}/reject`, {
    token: tokens.shro, json: { reason: 'Does not meet the minimum education/experience requirements for this role.' }
  });
  console.log('  Nancy Tumwine -> Rejected via explicit HR action (distinct from the panel-recommendation path in Phase 5)');

  await api('PATCH', `/api/vacancies/${v38.id}/close`, { token: tokens.phro });
  console.log('  Vacancy 38 -> Closed by Principal HR Officer.\n');

  console.log('=== Done. ===');
  console.log('Left for live demo:');
  console.log(`  - Vacancy ${pendingApprovalVacancy.id} (${pendingApprovalVacancy.jobRef}) - approve it live (Manager/Director), and it is already SLA-overdue.`);
  console.log(`  - Vacancy ${v57.id} (${v57.jobRef}) - approve the proposed shortlist live (Principal HR Officer+): POST /api/applications/vacancies/${v57.id}/approve-shortlist`);
  console.log(`  - Department "${pendingDept.name}" (id ${pendingDept.id}) - approve/reject it live (Principal HR Officer+).`);
  console.log(`  - Application ${frank.app.id} (Frank Mugisha, AVSEC) - recommend for offer live (Principal HR Officer+).`);
  console.log(`  - Application ${kevin.app.id} (Kevin Byaruhanga, promoted Reserve->Primary) - recommend for offer live.`);
  console.log('\nRun `node scripts/checkSlaEscalations.js` next to turn the backdated PendingApproval vacancy into a real escalation + notification.');
  console.log(`\nAll seeded candidate logins use password: ${PASSWORD}`);
}

main()
  .catch((e) => { console.error('\nSEED FAILED:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
