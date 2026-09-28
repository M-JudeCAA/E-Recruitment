// Demo-data seeder that populates an EMPTY database (after
// scripts/resetDemoData.js) with vacancies at every stage of the current
// selection workflow - vacancy approval, applications and screening, the
// interview shortlist, the Interview Hub (sessions, rubrics, panel scoring,
// recusal, no-shows, reschedules, cancellations), the post-interview merit
// list, and the full offer lifecycle (returned/revised, issued, accepted,
// declined, expired, withdrawn, with reserve promotion) - leaving real actions
// for each staff tier to perform live.
//
// Drives the real API (every business rule runs) by starting the Express app
// in-process on a free port with SMTP_HOST=json, so no email leaves the
// machine. Direct DB access is used only where the API has no way in: reading
// email-confirmation tokens, and back-dating timestamps so the history reads
// like weeks of real work rather than one minute.
//
// Usage (the API does not need to be running):
//   node scripts/resetDemoData.js --yes
//   node scripts/seedFullWorkflowDemoData.js
//
// Staff logins are the seeded accounts (prisma/seed.js, password ChangeMe123!).
// Every candidate login uses the password printed at the end.
require('dotenv').config();
// Set before anything loads the mailer: nothing is emailed to the seeded
// addresses, however SMTP is configured in .env.
process.env.SMTP_HOST = 'json';

const prisma = require('../src/config/db');
const app = require('../src/app');
const { runJob } = require('../src/utils/jobRunner');

const PASSWORD = 'DemoPass123!';
const STAFF_PASSWORD = 'ChangeMe123!';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const TZ = '+03:00'; // Africa/Kampala, no daylight saving

let BASE;

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

async function api(method, path, { token, json, form, ip } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // The app trusts a loopback proxy, so each seeded candidate can present its
  // own address and stay inside the per-address registration limit.
  if (ip) headers['X-Forwarded-For'] = ip;
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

const ago = (days) => new Date(NOW - days * DAY);
const daysAgoOf = (date) => (NOW - new Date(date).getTime()) / DAY;

function klaDate(date) {
  return new Date(new Date(date).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// YYYY-MM-DD of the n-th working day after today (Kampala).
function workday(n) {
  const d = new Date(`${klaDate(NOW)}T12:00:00${TZ}`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

const at = (ymd, hm) => new Date(`${ymd}T${hm}:00${TZ}`);
const dateOnly = (daysFromNow) => klaDate(NOW + daysFromNow * DAY);

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

const log = (msg) => console.log(msg);

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const STAFF_EMAILS = {
  hro: 'hro@caa.co.ug', shro: 'shro@caa.co.ug', phro: 'phro@caa.co.ug', manager: 'manager@caa.co.ug', dhra: 'dhra@caa.co.ug'
};
const T = {}; // staff tokens

async function loginStaff() {
  for (const [key, email] of Object.entries(STAFF_EMAILS)) {
    const r = await api('POST', '/api/staff/auth/login', { json: { email, password: STAFF_PASSWORD } });
    T[key] = r.token;
  }
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

let candidateSeq = 0;

// Matches /^C[FM]\d{2}[A-Za-z0-9]{10}$/ (validators.js), unique per candidate.
function nationalId(sex, dob, n) {
  const letters = Array.from({ length: 4 }, (_, i) => String.fromCharCode(65 + (Math.floor((n * 7 + 3) / 26 ** i) % 26))).join('');
  return `C${sex}${dob.slice(2, 4)}${String(100000 + n).slice(-6)}${letters}`;
}

function slug(name) {
  return name.toLowerCase().replace(/^(capt|eng|dr)\.\s*/, '').replace(/[^a-z ]/g, '').trim().split(/\s+/).join('.');
}

const yearsAgo = (years) => new Date(NOW - years * 365.25 * DAY).toISOString().slice(0, 10);

function referees(c) {
  const pool = [
    ['Grace Nakato', 'Former Supervisor', 'Uganda Airlines', '0772 114 220'],
    ['Peter Okello', 'Line Manager', c.work?.[0]?.employer || 'Entebbe Handling Services', '0701 333 481'],
    ['Dr. Sarah Mbabazi', 'Academic Referee', c.education?.[0]?.institution || 'Makerere University', '0752 555 690'],
    ['Joseph Kiggundu', 'Colleague', 'Civil Aviation Training School', '0782 240 117'],
    ['Harriet Atim', 'Former Head of Department', 'Kyambogo University', '0703 881 205']
  ];
  const start = c.n % 3;
  return JSON.stringify(pool.slice(start, start + 3).map(([name, relationship, organization, phone]) => ({
    name, relationship, organization, phone, email: `${slug(name)}@example.com`
  })));
}

// spec: { name, sex, dob, internal?, location?, flyingHours?, education[], work[], exams[], certs[], internalProfile? }
async function makeCandidate(spec) {
  candidateSeq += 1;
  const n = candidateSeq;
  const ip = `10.77.${Math.floor(n / 200)}.${(n % 200) + 20}`;
  const email = spec.internal ? `demo.${slug(spec.name)}@caa.co.ug` : `${slug(spec.name)}@example.com`;
  const nid = nationalId(spec.sex, spec.dob, n);
  const phone = `07${70 + (n % 9)} ${String(100 + n * 37).slice(-3)} ${String(200 + n * 53).slice(-3)}`;

  await api('POST', '/api/candidates/auth/register', {
    ip, json: { fullName: spec.name, email, password: PASSWORD, phone, nationalId: nid }
  });
  const t = await prisma.verificationToken.findFirst({
    where: { type: 'EmailConfirmation', pendingRegistration: { email } }, orderBy: { createdAt: 'desc' }
  });
  await api('GET', `/api/candidates/auth/confirm-email?token=${encodeURIComponent(t.token)}`, { ip });
  const { token } = await api('POST', '/api/candidates/auth/login', { ip, json: { email, password: PASSWORD } });

  await api('PUT', '/api/candidates/me', {
    token,
    json: {
      nationalId: nid, idType: 'NationalID', location: spec.location || 'Kampala, Uganda', workAuthorization: 'Yes',
      dateOfBirth: spec.dob, flyingHours: spec.flyingHours,
      linkedinUrl: n % 3 === 0 ? `https://www.linkedin.com/in/${slug(spec.name).replace(/\./g, '-')}` : undefined
    }
  });
  for (const e of spec.education) await api('POST', '/api/candidates/me/education', { token, json: e });
  for (const w of spec.work) await api('POST', '/api/candidates/me/work-experience', { token, json: w });
  for (const g of spec.exams || []) await api('POST', '/api/candidates/me/exam-grades', { token, json: g });
  for (const c of spec.certs || []) await api('POST', '/api/candidates/me/certificates', { token, json: c });
  if (spec.internal) await api('PUT', '/api/candidates/me/internal-profile', { token, json: spec.internalProfile });

  const row = await prisma.candidate.findUnique({ where: { email } });
  return { ...spec, n, id: row.id, email, token, ip };
}

// Answers default to meeting every eligibility question, and to "yes" on the
// desirable ones for stronger candidates; desirable/disq override by index.
async function apply(c, vacancy, { submit = true, strong = true, desirable = {}, disq = {}, why } = {}) {
  const desirableResponses = (vacancy.desirableRequirements || []).map((r, i) => ({
    id: r.id,
    answer: i in desirable ? desirable[i]
      : r.answerType === 'number' ? (strong ? (r.minValue || 0) + 2 : Math.max(0, (r.minValue || 1) - 1))
        : strong || i === 0
  }));
  const disqualifyingResponses = (vacancy.disqualifyingRequirements || []).map((r, i) => ({
    id: r.id,
    answer: i in disq ? disq[i] : r.answerType === 'number' ? (r.minValue || 0) + 1 : r.requiredAnswer === 'Yes'
  }));
  const form = new FormData();
  form.append('vacancyId', String(vacancy.id));
  form.append('desiredSalary', 'As per the UCAA salary scale');
  form.append('openToRelocate', c.n % 4 === 0 ? 'Depends' : 'Yes');
  form.append('earliestStartDate', dateOnly(30));
  form.append('whyThisRole', why || `I would like to bring my experience to the ${vacancy.title} role and grow with the Authority's aviation safety and service mandate.`);
  form.append('desirableResponses', JSON.stringify(desirableResponses));
  form.append('disqualifyingResponses', JSON.stringify(disqualifyingResponses));
  form.append('referees', referees(c));
  const draft = await api('POST', '/api/applications', { token: c.token, form });
  if (!submit) return draft;
  return api('PATCH', `/api/applications/${draft.id}/submit`, { token: c.token });
}

const edu = (institution, qualificationLevel, fieldOfStudy, yearCompleted, cgpa) => ({ institution, qualificationLevel, fieldOfStudy, yearCompleted, cgpa });
const job = (employer, jobTitle, startYearsAgo, endYearsAgo, duties) => ({
  employer, jobTitle, startDate: yearsAgo(startYearsAgo), endDate: endYearsAgo ? yearsAgo(endYearsAgo) : undefined, duties
});
const cert = (name, issuingOrganization, issuedYearsAgo, validYears) => ({
  name, issuingOrganization, issueDate: yearsAgo(issuedYearsAgo), expiryDate: validYears ? yearsAgo(issuedYearsAgo - validYears) : undefined
});
const olevel = (subject, grade) => ({ level: 'OLevel', subject, grade });
const alevel = (subject, grade) => ({ level: 'ALevel', subject, grade });

// ---------------------------------------------------------------------------
// Staff-side workflow helpers
// ---------------------------------------------------------------------------

async function createVacancy(body, approver = 'manager') {
  const v = await api('POST', '/api/vacancies', { token: T.hro, json: body });
  if (approver) await api('PATCH', `/api/vacancies/${v.id}/approve`, { token: T[approver] });
  return v;
}

const beginReview = (vacancyId) => api('PATCH', `/api/vacancies/${vacancyId}/begin-review`, { token: T.shro });
const reject = (applicationId, reason) => api('PATCH', `/api/applications/${applicationId}/reject`, { token: T.shro, json: { reason } });

async function proposeShortlist(vacancyId, applicationIds) {
  const apps = await api('GET', `/api/vacancies/${vacancyId}/applications`, { token: T.shro });
  const versions = Object.fromEntries(apps.map((a) => [a.id, a.rankVersion]));
  return api('POST', `/api/vacancies/${vacancyId}/rank`, { token: T.shro, json: { applicationIds, applicationRankVersions: versions } });
}

const approveShortlist = (vacancyId) => api('POST', `/api/applications/vacancies/${vacancyId}/approve-shortlist`, { token: T.phro });

async function verifyInternal(candidateId, decision, comments) {
  const form = new FormData();
  form.append('decision', decision);
  form.append('comments', comments);
  return api('PATCH', `/api/verification/candidates/${candidateId}/verify`, { token: T.shro, form });
}

const panel = (list) => list.map(([name, trade, isChair]) => ({ name, trade, email: `${slug(name)}@example.com`, isChair: !!isChair }));

// Books a back-to-back session; returns the rounds keyed by application id.
async function scheduleSession(vacancyId, applicationIds, opts) {
  const r = await api('POST', `/api/interviews/vacancies/${vacancyId}/sessions`, {
    token: T.shro,
    json: { applicationIds, tzOffsetMinutes: -180, gapMinutes: 15, durationMinutes: 45, allowConflicts: true, ...opts }
  });
  return Object.fromEntries(r.rounds.map((round) => [round.applicationId, round]));
}

const scheduleOne = (applicationId, opts) => api('POST', `/api/interviews/applications/${applicationId}/interviews`, {
  token: T.shro, json: { durationMinutes: 45, allowConflicts: true, ...opts }
});

// Moves rounds back in time: they were booked in the future (so candidates
// could confirm them), and this turns them into interviews that took place.
async function shiftRounds(rounds, days) {
  for (const round of rounds) {
    await prisma.interviewRound.update({
      where: { id: round.id },
      data: { scheduledDate: new Date(new Date(round.scheduledDate).getTime() - days * DAY) }
    });
  }
}

const respond = (c, round, response, note) => api('PATCH', `/api/candidates/me/interviews/${round.id}/respond`, { token: c.token, json: { response, note } });

// Ratings (1-5) per rubric criterion that land near a 0-100 target.
function ratingsFor(criteria, target, salt) {
  const wobble = [0, 0.4, -0.4, 0.2, -0.2];
  return Object.fromEntries(criteria.map((c, i) => [c.id, Math.min(5, Math.max(1, Math.round(target / 20 + wobble[(i + salt) % wobble.length])))]));
}

const COMMENTS = {
  high: ['Excellent command of the subject; answered the scenario questions with confidence.', 'Strong, structured answers and clear safety awareness.', 'Very well prepared - the best technical depth on the day.'],
  mid: ['Solid fundamentals, some hesitation on the regulatory questions.', 'Good communicator; technical answers adequate but not deep.', 'Capable candidate who would benefit from more hands-on exposure.'],
  low: ['Struggled with the core technical questions.', 'Answers were generic and lacked practical examples.', 'Limited understanding of what the role requires.']
};

// Proxy-scores panelists on HR's side: { panelIndex: target 0-100 }.
async function score(round, targets) {
  for (const [idx, target] of Object.entries(targets)) {
    const m = round.panelMembers[idx];
    const salt = Number(idx) + round.id;
    const band = target >= 75 ? 'high' : target >= 55 ? 'mid' : 'low';
    await api('PATCH', `/api/interviews/panel-members/${m.id}/score`, {
      token: T.shro,
      json: round.criteria
        ? { criterionScores: ratingsFor(round.criteria, target, salt), comments: COMMENTS[band][salt % 3] }
        : { score: target, comments: COMMENTS[band][salt % 3] }
    });
  }
}

const finalize = (round, recommendation, notes) => api('PATCH', `/api/interviews/${round.id}/finalize`, { token: T.shro, json: { recommendation, notes } });

// Every panelist scores, then HR finalizes the panel's verdict.
async function hold(round, targets, recommendation, notes) {
  await score(round, Object.fromEntries(targets.map((t, i) => [i, t])));
  await finalize(round, recommendation, notes);
}

async function proposeMerit(vacancyId, applicationIds) {
  const board = await api('GET', `/api/applications/vacancies/${vacancyId}/merit-list`, { token: T.shro });
  const versions = Object.fromEntries([...board.entries, ...board.eligible].map((r) => [r.applicationId, r.rankVersion]));
  return api('POST', `/api/applications/vacancies/${vacancyId}/merit-list`, { token: T.shro, json: { applicationIds, applicationRankVersions: versions } });
}

const approveMerit = (vacancyId) => api('POST', `/api/applications/vacancies/${vacancyId}/merit-list/approve`, { token: T.phro });

const CONDITIONS = [
  'Satisfactory reference checks',
  'Verification of academic certificates by the awarding institutions',
  'A certificate of medical fitness from a UCAA-approved medical examiner'
];
const OFFER_DEFAULTS = { salaryPeriod: 'Monthly', employmentCategory: 'FullTime', conditions: CONDITIONS, responseDays: 14 };

const recommendOffer = (applicationId, terms) => api('POST', `/api/applications/${applicationId}/recommend-offer`, {
  token: T.phro, json: { ...OFFER_DEFAULTS, startDate: dateOnly(35), ...terms }
});
const approveOffer = (offerId, who = 'manager') => api('PATCH', `/api/applications/offers/${offerId}/approve`, { token: T[who] });

// Back-dates an offer's milestones (days ago) and recomputes the response
// deadline from the new approval date, as approval itself would have.
async function offerDates(offerId, { recommended, approved, decided, returned }) {
  const o = await prisma.offer.findUnique({ where: { id: offerId } });
  const data = {};
  if (recommended != null) data.recommendedDate = ago(recommended);
  if (returned != null) data.returnedAt = ago(returned);
  if (approved != null) {
    data.approvedDate = ago(approved);
    data.responseDeadline = new Date(ago(approved).getTime() + o.responseDays * DAY);
  }
  if (decided != null) data.decidedAt = ago(decided);
  await prisma.offer.update({ where: { id: offerId }, data });
}

// ---------------------------------------------------------------------------
// History - back-dating so the timeline is plausible
// ---------------------------------------------------------------------------

// t (days ago): created, deadline (negative = in the future), review,
// slProposed, slApproved, meritProposed, meritApproved, changed, rejected.
// Applications are spread across the advertising window; rounds that already
// took place get creation, response and scoring times around their date.
async function retime(vacancyId, t) {
  const v = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
  const data = { createdAt: ago(t.created) };
  if (v.approvedAt) data.approvedAt = ago(t.created - 0.9);
  if (t.deadline != null) data.deadline = at(klaDate(ago(t.deadline)), '17:00');
  if (v.reviewStartedAt && t.review != null) data.reviewStartedAt = ago(t.review);
  if (v.postingTypeChangedAt && t.changed != null) data.postingTypeChangedAt = ago(t.changed);
  await prisma.vacancy.update({ where: { id: vacancyId }, data });

  const apps = await prisma.application.findMany({ where: { vacancyId }, orderBy: { id: 'asc' }, include: { interviewRounds: true } });
  const from = t.created - 1.1;
  const to = t.deadline != null && t.deadline > 0 ? t.deadline + 0.3 : 0.2;
  for (let i = 0; i < apps.length; i += 1) {
    const a = apps[i];
    const sub = from - ((from - to) * (i + 1)) / (apps.length + 1);
    const d = { createdAt: ago(sub + 0.08) };
    if (a.submittedDate) d.submittedDate = ago(sub);
    if (a.screenedAt && t.review != null) d.screenedAt = ago(Math.min(t.review, sub - 0.01));
    if (a.shortlistProposedAt && t.slProposed != null) d.shortlistProposedAt = ago(t.slProposed);
    if (a.shortlistApprovedAt && t.slApproved != null) d.shortlistApprovedAt = ago(t.slApproved);
    if (a.meritProposedAt && t.meritProposed != null) d.meritProposedAt = ago(t.meritProposed);
    if (a.meritApprovedAt && t.meritApproved != null) d.meritApprovedAt = ago(t.meritApproved);
    if (a.rejectedAt) {
      const panelReject = a.interviewRounds.find((r) => r.recommendation === 'Reject');
      d.rejectedAt = panelReject
        ? new Date(new Date(panelReject.scheduledDate).getTime() + DAY)
        : ago(t.rejected ?? Math.max(0.1, (t.review ?? 1) - 0.4));
    }
    await prisma.application.update({ where: { id: a.id }, data: d });

    for (const r of a.interviewRounds) {
      if (!r.scheduledDate || new Date(r.scheduledDate).getTime() > NOW) continue;
      const when = new Date(r.scheduledDate).getTime();
      const createdDaysAgo = Math.max(daysAgoOf(when) + 1, (t.slApproved ?? daysAgoOf(when) + 2) - 0.3);
      const rd = { createdAt: ago(createdDaysAgo) };
      if (r.candidateRespondedAt) rd.candidateRespondedAt = ago(createdDaysAgo - 0.8);
      if (r.completedAt) rd.completedAt = new Date(when + DAY);
      await prisma.interviewRound.update({ where: { id: r.id }, data: rd });
      await prisma.panelMember.updateMany({
        where: { interviewRoundId: r.id, submittedAt: { not: null } },
        data: { submittedAt: new Date(when + 3 * 60 * 60 * 1000) }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Org structure
// ---------------------------------------------------------------------------

const POS = {};

async function seedOrg() {
  log('=== Org structure ===');
  const directorates = await api('GET', '/api/directorates', { token: T.hro });
  const dir = Object.fromEntries(directorates.map((d) => [d.name, d.id]));

  // New departments go through propose -> approve (Principal HR Officer+).
  const atm = await api('POST', '/api/departments', { token: T.hro, json: { name: 'ATM', directorateId: dir.DANS } });
  const aim = await api('POST', '/api/departments', { token: T.hro, json: { name: 'AIM', directorateId: dir.DANS } });
  await api('PATCH', `/api/departments/${atm.id}/approve`, { token: T.phro });
  await api('PATCH', `/api/departments/${aim.id}/approve`, { token: T.phro });
  const protocol = await api('POST', '/api/departments', { token: T.hro, json: { name: 'PROTOCOL', directorateId: dir.CORP } });
  await api('PATCH', `/api/departments/${protocol.id}/reject`, {
    token: T.phro, json: { reason: 'Protocol sits under the Corporate Affairs office (CWG) - a separate department is not needed.' }
  });
  const sms = await api('POST', '/api/departments', { token: T.hro, json: { name: 'SMS', directorateId: dir.DSSER } });
  // Waiting past its 48h SLA, so the escalation job has something to escalate.
  await prisma.department.update({ where: { id: sms.id }, data: { createdAt: ago(3) } });
  log('  Departments ATM + AIM (DANS) approved, PROTOCOL (CORP) rejected, SMS (DSSER) left Pending');

  const approved = await api('GET', '/api/departments/approved', { token: T.hro });
  const dept = Object.fromEntries(approved.map((d) => [`${d.name}/${d.directorate.name}`, d.id]));

  const positions = [
    ['atcSenior', 'Senior Air Traffic Control Officer', 'ATM/DANS', 3],
    ['atc1', 'Air Traffic Control Officer I', 'ATM/DANS', 2],
    ['atcTrainee', 'Air Traffic Control Officer (Trainee)', 'ATM/DANS', 1],
    ['ais', 'Aeronautical Information Officer', 'AIM/DANS', 1],
    ['avsec', 'Aviation Security Officer', 'AVSEC/DAAS', 1],
    ['avsecSenior', 'Senior Aviation Security Officer', 'AVSEC/DAAS', 2],
    ['fireFighter', 'Fire Fighter', 'ARFFS/DAAS', 1],
    ['fireOfficer', 'Fire Officer', 'ARFFS/DAAS', 2],
    ['itSupport', 'IT Support Officer', 'IT/CORP', 1],
    ['sysadmin', 'Systems Administrator', 'IT/CORP', 2],
    ['itManager', 'Manager Information Technology', 'IT/CORP', 3],
    ['accountant', 'Accountant', 'FINANCE/DF', 1],
    ['seniorAccountant', 'Senior Accountant', 'FINANCE/DF', 2],
    ['financeManager', 'Manager Finance', 'FINANCE/DF', 3],
    ['hrOfficer', 'Human Resource Officer', 'HR/DHRA', 1],
    ['flightOps', 'Flight Operations Inspector', 'FSS/DSSER', 2]
  ];
  for (const [key, name, d, level] of positions) {
    POS[key] = await api('POST', '/api/positions', { token: T.hro, json: { name, departmentId: dept[d], level } });
  }
  log(`  ${positions.length} positions created`);

  const staff = await api('GET', '/api/staff-users', { token: T.phro });
  const shro = staff.find((s) => s.email === STAFF_EMAILS.shro);
  await api('POST', '/api/delegations', {
    token: T.phro,
    json: { delegateId: shro.id, startDate: dateOnly(-2), endDate: dateOnly(5), reason: 'Covering Principal HR Officer approvals during annual leave.' }
  });
  log('  Delegation: Principal HR Officer -> Senior HR Officer (active this week)\n');
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const purpose = (summary, duties) => `<p>${summary}</p><p><strong>Principal accountabilities</strong></p><ul>${duties.map((d) => `<li>${d}</li>`).join('')}</ul>`;
const LIVE = [];

// Senior Accountant - finished: an offer withdrawn before approval, the
// reserve promoted, offered and accepted -> Filled.
async function scenarioFilled() {
  log('=== Senior Accountant (External) - Filled ===');
  const v = await createVacancy({
    positionId: POS.seniorAccountant.id, reportsToPositionId: POS.financeManager.id,
    postingType: 'External', positionsRequired: 1, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'UCAA Head Office — Entebbe',
    salaryScale: 'U4 (UGX 4,200,000 - 5,600,000 per month)', internalSalaryRange: 'UGX 4.6M - 5.1M budgeted',
    minimumEducationLevel: 'Bachelors', minimumExperienceYears: 4, preferredFieldOfStudy: 'Accounting', minimumCGPA: 3.0,
    jobPurpose: purpose('To prepare and review the Authority\'s financial statements and management accounts in line with IFRS and the PFMA.', [
      'Prepare monthly management accounts and year-end financial statements', 'Reconcile ledgers, bank accounts and aeronautical revenue collections',
      'Support internal and external audits', 'Supervise and coach accountants in the section'
    ]),
    essentialRequirements: ['Bachelor\'s degree in Accounting, Finance or Commerce', 'Full professional qualification (CPA, ACCA or CIMA)', 'At least 4 years of post-qualification experience'],
    desirableRequirements: [{ text: 'Do you have experience with an ERP system (SAP, Oracle or Microsoft Dynamics)?', answerType: 'yesno' }, { text: 'Are you a full member of ICPAU?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Do you hold a full professional accounting qualification (CPA/ACCA/CIMA)?', requiredAnswer: 'Yes' }],
    specialSkills: ['Advanced Excel and financial modelling', 'Attention to detail and integrity']
  }, 'dhra');

  const [x, y, z] = await inBatches([
    { name: 'Rebecca Nansubuga', sex: 'F', dob: '1989-03-14', education: [edu('Makerere University Business School', 'Bachelors', 'Accounting', 2011, 3.9)], work: [job('KPMG Uganda', 'Audit Senior', 9, 5), job('Uganda Revenue Authority', 'Accountant', 5)], certs: [cert('CPA (Uganda)', 'ICPAU', 8)] },
    { name: 'Emmanuel Kato', sex: 'M', dob: '1987-11-02', education: [edu('Makerere University', 'Bachelors', 'Commerce', 2010, 3.7)], work: [job('Stanbic Bank Uganda', 'Finance Officer', 11, 4), job('National Water and Sewerage Corporation', 'Senior Accountant', 4)], certs: [cert('ACCA', 'ACCA', 7)] },
    { name: 'Doreen Akello', sex: 'F', dob: '1991-06-21', education: [edu('Uganda Christian University', 'Bachelors', 'Accounting and Finance', 2013, 3.4)], work: [job('Mukwano Group', 'Accountant', 6)], certs: [cert('CPA (Uganda)', 'ICPAU', 4)] }
  ], 3, makeCandidate);
  const ax = await apply(x, v);
  const ay = await apply(y, v);
  const az = await apply(z, v, { strong: false });
  await beginReview(v.id);
  await proposeShortlist(v.id, [ax.id, ay.id, az.id]);
  await approveShortlist(v.id);

  const rounds = await scheduleSession(v.id, [ax.id, ay.id, az.id], {
    startsAt: at(workday(2), '09:00'), mode: 'In-person', location: 'Board Room, UCAA Head Office — Entebbe',
    instructions: 'Please bring the originals of your academic and professional certificates.',
    panelMembers: panel([['Christine Namutebi', 'Manager Finance', true], ['Florence Akello', 'Human Resource Representative'], ['Joel Byamugisha', 'Principal Accountant']]),
    criteria: [{ name: 'Technical accounting (IFRS, PFMA)', weight: 3 }, { name: 'Analysis and problem solving', weight: 2 }, { name: 'Communication', weight: 2 }, { name: 'Leadership and integrity', weight: 2 }]
  });
  await shiftRounds(Object.values(rounds), 21);
  await hold(rounds[ax.id], [86, 82, 88], 'Shortlist');
  await hold(rounds[ay.id], [78, 80, 74], 'Shortlist');
  await hold(rounds[az.id], [52, 48, 56], 'Reject', 'Did not show the IFRS knowledge expected at senior level.');
  const S = daysAgoOf(rounds[ax.id].scheduledDate) + 21;

  await proposeMerit(v.id, [ax.id, ay.id]);
  await approveMerit(v.id);
  const terms = { salaryAmount: 4900000, dutyStation: 'UCAA Head Office — Entebbe', allowances: 'Transport UGX 400,000; medical cover for self and four dependants' };
  const ox = await recommendOffer(ax.id, terms);
  await api('PATCH', `/api/applications/offers/${ox.id}/withdraw`, {
    token: T.phro, json: { reason: 'The awarding body could not confirm the candidate\'s professional certificate within the verification window.' }
  });
  const oy = await recommendOffer(ay.id, { ...terms, salaryAmount: 4800000 });
  await approveOffer(oy.id, 'dhra');
  await api('PATCH', `/api/applications/offers/${oy.id}/accept`, { token: y.token });

  await retime(v.id, { created: S + 12, deadline: S + 4, review: S + 3, slProposed: S + 2.6, slApproved: S + 2.2, meritProposed: S - 2, meritApproved: S - 2.5 });
  await offerDates(ox.id, { recommended: S - 3, decided: S - 4 });
  await offerDates(oy.id, { recommended: S - 4.5, approved: S - 5.5, decided: S - 8 });
  await prisma.vacancy.update({ where: { id: v.id }, data: { filledAt: ago(S - 8) } });
  log(`  ${v.jobRef}: Rebecca's offer withdrawn -> Emmanuel promoted from reserve, offered, accepted -> Filled\n`);
}

// Fire Officer - a decline and an expiry, each promoting the next reserve.
async function scenarioDeclineExpire() {
  log('=== Fire Officer (External) - decline + expiry cascade ===');
  const v = await createVacancy({
    positionId: POS.fireOfficer.id,
    postingType: 'External', positionsRequired: 2, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U5 (UGX 2,700,000 - 3,500,000 per month)', minimumEducationLevel: 'Diploma', minimumExperienceYears: 3, maximumAge: 40,
    jobPurpose: purpose('To lead a watch of the Aerodrome Rescue and Fire Fighting Service, keeping Entebbe at ICAO Category 9 readiness.', [
      'Command a fire and rescue watch during aircraft incidents', 'Plan and run live-fire and extrication drills', 'Inspect and maintain fire tenders and rescue equipment', 'Keep incident and training records'
    ]),
    essentialRequirements: ['Diploma in Fire Science, Disaster Management or a related field', 'At least 3 years as a fire fighter, 1 of them leading a crew', 'Valid Class CE driving permit'],
    desirableRequirements: [{ text: 'Do you hold an ICAO ARFF Supervisor certificate?', answerType: 'yesno' }, { text: 'How many live aircraft-fire drills have you led?', answerType: 'number', minValue: 5 }],
    disqualifyingRequirements: [{ text: 'Do you hold a valid Class CE driving permit?', requiredAnswer: 'Yes' }, { text: 'Are you able to work 24-hour shift rotations?', requiredAnswer: 'Yes' }]
  });

  const cands = await inBatches([
    ['Geoffrey Okumu', 'M', '1986-02-11', 'Uganda Police Fire and Rescue Services', 11, true],
    ['Irene Nakayima', 'F', '1988-08-30', 'Entebbe Handling Services', 9, true],
    ['Henry Tumusiime', 'M', '1990-05-17', 'Kilembe Mines Emergency Unit', 7, true],
    ['Kenneth Ssali', 'M', '1989-12-04', 'Uganda Police Fire and Rescue Services', 8, true],
    ['Josephine Adong', 'F', '1992-01-25', 'TotalEnergies Uganda', 5, false]
  ].map(([name, sex, dob, employer, years, supervisorCert]) => ({
    name, sex, dob, location: 'Entebbe, Uganda',
    education: [edu('Uganda Police Training School', 'Diploma', 'Fire Science and Rescue', years > 8 ? 2010 : 2015)],
    work: [job(employer, years > 7 ? 'Leading Fire Fighter' : 'Fire Fighter', years)],
    certs: supervisorCert ? [cert('ICAO ARFF Supervisor', 'East African School of Aviation', 3)] : [cert('Basic Fire Fighting', 'Uganda Police Fire and Rescue Services', 6)]
  })), 3, makeCandidate);
  const [g, i, h, k, j] = cands;
  const apps = {};
  for (const c of cands) apps[c.name] = await apply(c, v, { strong: c !== j });
  const ids = cands.map((c) => apps[c.name].id);
  await beginReview(v.id);
  await proposeShortlist(v.id, ids);
  await approveShortlist(v.id);

  const rounds = await scheduleSession(v.id, ids, {
    startsAt: at(workday(1), '09:00'), mode: 'In-person', location: 'ARFFS Main Fire Station, Entebbe', durationMinutes: 60,
    instructions: 'Wear sports attire - the interview includes a 20-minute practical rescue drill.',
    panelMembers: panel([['Samuel Wandera', 'Chief Fire Officer', true], ['Agnes Nakiwala', 'Human Resource Representative'], ['Isaac Ochieng', 'Station Officer, ARFFS']]),
    criteria: [{ name: 'Incident command', weight: 3 }, { name: 'Practical drill', weight: 3 }, { name: 'ARFF regulations (ICAO Annex 14)', weight: 2 }, { name: 'Communication', weight: 1 }]
  });
  await shiftRounds(Object.values(rounds), 21);
  const R = (c) => rounds[apps[c.name].id];
  await hold(R(g), [88, 85, 90], 'Shortlist');
  await hold(R(i), [84, 80, 82], 'Shortlist');
  await hold(R(h), [76, 78, 72], 'Shortlist');
  await hold(R(k), [72, 70, 74], 'Shortlist');
  await hold(R(j), [64, 60, 66], 'Hold', 'Good potential; limited crew-leading experience.');
  const S = daysAgoOf(R(g).scheduledDate) + 21;

  await proposeMerit(v.id, ids);
  await approveMerit(v.id);
  const terms = { salaryAmount: 3100000, dutyStation: 'Entebbe International Airport', allowances: 'Shift allowance UGX 350,000; risk allowance UGX 200,000' };
  const og = await recommendOffer(apps[g.name].id, terms);
  const oi = await recommendOffer(apps[i.name].id, { ...terms, responseDays: 10 });
  await approveOffer(og.id);
  await approveOffer(oi.id);
  await api('PATCH', `/api/applications/offers/${og.id}/decline`, { token: g.token, json: { reason: 'I have accepted a station commander role with my current employer.' } });
  await offerDates(og.id, { recommended: S - 3, approved: S - 4, decided: S - 8 });
  // Issued long enough ago that its response window has closed - the expiry
  // job then lapses it and promotes the next reserve.
  await offerDates(oi.id, { recommended: S - 3, approved: S - 4 });
  await runJob('expireOffers', require('./expireOffers').run);
  const expired = await prisma.offer.findUnique({ where: { id: oi.id } });
  await prisma.offer.update({ where: { id: oi.id }, data: { decidedAt: new Date(expired.responseDeadline.getTime() + 60 * 60 * 1000) } });

  const oh = await recommendOffer(apps[h.name].id, terms);
  await approveOffer(oh.id);
  await offerDates(oh.id, { recommended: S - 8.5, approved: S - 9.5 });

  await retime(v.id, { created: S + 12, deadline: S + 4, review: S + 3, slProposed: S + 2.6, slApproved: S + 2.2, meritProposed: S - 2, meritApproved: S - 2.5 });
  log(`  ${v.jobRef}: Geoffrey declined -> Henry promoted, offered (awaiting answer); Irene's offer expired -> Kenneth promoted; Josephine (Hold) in reserve\n`);
  LIVE.push(`${v.jobRef} Fire Officer - recommend Kenneth Ssali (promoted to Primary after an expiry) for an offer [Principal HR Officer]`);
  LIVE.push(`${v.jobRef} Fire Officer - Henry Tumusiime (${h.email}) can accept or decline his issued offer [candidate]`);
}

// Air Traffic Control Officer I - offers at every open stage.
async function scenarioOffers() {
  log('=== Air Traffic Control Officer I (External) - offers in progress ===');
  const v = await createVacancy({
    positionId: POS.atc1.id, reportsToPositionId: POS.atcSenior.id,
    postingType: 'External', positionsRequired: 4, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U4 (UGX 4,000,000 - 5,200,000 per month)', internalSalaryRange: 'Budget approved for 4 posts at U4 entry point',
    recruiterNotes: 'Appointees must pass the ICAO Class 3 medical before starting - flag known medical issues early.',
    minimumEducationLevel: 'Bachelors', minimumExperienceYears: 1, maximumAge: 32, minimumCGPA: 3.0,
    requiredExamGrades: [{ level: 'ALevel', subject: 'Mathematics', minGrade: 'C' }, { level: 'ALevel', subject: 'Physics', minGrade: 'C' }],
    jobPurpose: purpose('To provide safe, orderly and expeditious air traffic control services within the Entebbe Terminal Control Area.', [
      'Provide aerodrome and approach control services', 'Coordinate with adjacent units and airline operators', 'Keep ATC logs and occurrence reports', 'Take part in contingency and emergency exercises'
    ]),
    essentialRequirements: ['Bachelor\'s degree in a science, engineering or aviation discipline', 'A-Level passes in Mathematics and Physics', 'Able to obtain an ICAO Class 3 medical certificate'],
    desirableRequirements: [{ text: 'Do you hold an ATC licence or student ATC licence?', answerType: 'yesno' }, { text: 'What is your ICAO English Language Proficiency level (1-6)?', answerType: 'number', minValue: 4 }],
    disqualifyingRequirements: [{ text: 'Are you willing to work rostered night and weekend shifts?', requiredAnswer: 'Yes' }],
    generalKnowledge: ['ICAO Annex 11 and Doc 4444', 'Basic aviation meteorology'], specialSkills: ['Situational awareness under pressure', 'Clear radiotelephony']
  });

  const cands = await inBatches([
    ['Brenda Namuli', 'F', '1996-04-09', 'Physics', 3.8, 'Uganda Airlines', 'Flight Dispatcher'],
    ['Daniel Opolot', 'M', '1995-10-22', 'Aeronautical Engineering', 3.9, 'Eagle Air', 'Operations Officer'],
    ['Esther Nabwire', 'F', '1997-02-14', 'Mathematics', 3.6, 'Entebbe Handling Services', 'Load Controller'],
    ['Allan Mwesigwa', 'M', '1996-07-03', 'Aviation Management', 3.5, 'Kenya Airways (Entebbe)', 'Station Agent'],
    ['Patience Kyomuhendo', 'F', '1995-12-19', 'Physics', 3.4, 'Uganda National Meteorological Authority', 'Weather Observer'],
    ['Ivan Ssebunya', 'M', '1996-09-28', 'Electrical Engineering', 3.3, 'Aviation Handling Services', 'Ramp Supervisor'],
    ['Collins Wafula', 'M', '1997-05-06', 'Computer Science', 3.1, 'Jambojet', 'Customer Service Agent']
  ].map(([name, sex, dob, field, cgpa, employer, title]) => ({
    name, sex, dob,
    education: [edu(field.includes('Aviation') ? 'Kyambogo University' : 'Makerere University', 'Bachelors', field, 2018, cgpa)],
    work: [job(employer, title, 4)],
    exams: [alevel('Mathematics', cgpa > 3.5 ? 'A' : 'B'), alevel('Physics', cgpa > 3.5 ? 'B' : 'C'), olevel('English Language', '2')]
  })), 4, makeCandidate);
  const [a, b, c, d, e, f, x] = cands;
  const apps = {};
  for (const cand of cands) apps[cand.name] = await apply(cand, v, { strong: cand !== x });
  const ids = cands.map((cand) => apps[cand.name].id);
  await beginReview(v.id);
  await proposeShortlist(v.id, ids);
  await approveShortlist(v.id);

  const rounds = await scheduleSession(v.id, ids, {
    startsAt: at(workday(1), '08:30'), mode: 'In-person', location: 'ATC Training Room, Old Control Tower, Entebbe', durationMinutes: 40, gapMinutes: 10,
    instructions: 'Report to the Old Control Tower reception 20 minutes early with your national ID.',
    internalNotes: 'Tower simulator booked for the practical part - confirm with the ATS Training Unit.',
    panelMembers: panel([['Josephine Nabwire', 'Manager Air Traffic Management', true], ['Richard Opio', 'Senior Air Traffic Control Officer'], ['Diana Kyeyune', 'Human Resource Representative']]),
    criteria: [{ name: 'Aviation technical knowledge', weight: 3 }, { name: 'Spatial reasoning (simulator)', weight: 3 }, { name: 'Communication and phraseology', weight: 2 }, { name: 'Decision making under pressure', weight: 2 }]
  });
  await shiftRounds(Object.values(rounds), 14);
  const R = (cand) => rounds[apps[cand.name].id];
  await hold(R(a), [90, 88, 86], 'Shortlist');
  await hold(R(b), [86, 84, 88], 'Shortlist');
  await hold(R(c), [82, 80, 84], 'Shortlist');
  await hold(R(d), [80, 76, 78], 'Shortlist');
  await hold(R(e), [74, 72, 76], 'Shortlist');
  await hold(R(f), [66, 64, 62], 'Hold', 'Borderline on the simulator; keep in reserve.');
  await hold(R(x), [44, 50, 46], 'Reject', 'Weak spatial reasoning on the simulator exercise.');
  const S = daysAgoOf(R(a).scheduledDate) + 14;

  await proposeMerit(v.id, [a, b, c, d, e, f].map((cand) => apps[cand.name].id));
  await approveMerit(v.id);
  const terms = { salaryAmount: 4300000, dutyStation: 'Entebbe International Airport', allowances: 'Shift allowance UGX 500,000; licence allowance once rated' };

  // Accepted.
  const oa = await recommendOffer(apps[a.name].id, terms);
  await approveOffer(oa.id);
  await api('PATCH', `/api/applications/offers/${oa.id}/accept`, { token: a.token });
  await offerDates(oa.id, { recommended: S - 3, approved: S - 3.5, decided: S - 6 });

  // Returned, revised, then issued - waiting on the candidate.
  const ob = await recommendOffer(apps[b.name].id, { ...terms, startDate: dateOnly(20) });
  await api('PATCH', `/api/applications/offers/${ob.id}/return`, {
    token: T.manager, json: { reason: 'The start date clashes with the ab-initio ATC course intake - move it to the first Monday after the course begins.' }
  });
  await api('PATCH', `/api/applications/offers/${ob.id}`, { token: T.phro, json: { ...OFFER_DEFAULTS, ...terms, startDate: dateOnly(35) } });
  await approveOffer(ob.id);
  await offerDates(ob.id, { recommended: S - 3, returned: S - 3.5, approved: S - 6.5 });

  // Returned - waiting on the Principal HR Officer to revise it.
  const od = await recommendOffer(apps[d.name].id, { ...terms, salaryAmount: 5600000 });
  await api('PATCH', `/api/applications/offers/${od.id}/return`, {
    token: T.manager, json: { reason: 'UGX 5,600,000 is above the U4 entry point approved for this intake. Revise to UGX 4,300,000 in line with the other appointees.' }
  });
  await offerDates(od.id, { recommended: S - 5, returned: S - 6 });

  // Recommended two days ago - in the Manager's approval queue, past its SLA.
  const oc = await recommendOffer(apps[c.name].id, terms);
  await offerDates(oc.id, { recommended: 2 });

  await retime(v.id, { created: S + 12, deadline: S + 4, review: S + 3, slProposed: S + 2.6, slApproved: S + 2.2, meritProposed: S - 1.5, meritApproved: S - 2 });
  log(`  ${v.jobRef}: Brenda accepted (1/4 filled); Daniel's offer returned, revised and issued; Allan's returned; Esther's awaiting approval; Patience + Ivan in reserve; Collins rejected by the panel\n`);
  LIVE.push(`${v.jobRef} ATC Officer I - approve or return Esther Nabwire's offer, overdue on its SLA [Manager/Director]`);
  LIVE.push(`${v.jobRef} ATC Officer I - revise Allan Mwesigwa's returned offer [Principal HR Officer]`);
  LIVE.push(`${v.jobRef} ATC Officer I - Daniel Opolot (${b.email}) can accept or decline his issued offer [candidate]`);
}

// Systems Administrator - merit list proposed, awaiting approval.
async function scenarioMeritProposed() {
  log('=== Systems Administrator (External) - merit list awaiting approval ===');
  const v = await createVacancy({
    positionId: POS.sysadmin.id, reportsToPositionId: POS.itManager.id,
    postingType: 'External', positionsRequired: 1, deadline: dateOnly(20), employmentCategory: 'Contract', location: 'UCAA Head Office — Entebbe',
    salaryScale: 'U5 (UGX 3,000,000 - 3,900,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 3, preferredFieldOfStudy: 'Computer Science',
    jobPurpose: purpose('To administer the Authority\'s server, virtualisation and identity infrastructure, including systems that support air navigation services.', [
      'Administer Windows and Linux servers and the VMware cluster', 'Manage Active Directory, Microsoft 365 and backup schedules', 'Patch and harden systems against the UCAA security baseline', 'Document configurations and support disaster-recovery tests'
    ]),
    essentialRequirements: ['Bachelor\'s degree in Computer Science, IT or Computer Engineering', 'At least 3 years administering production servers'],
    desirableRequirements: [{ text: 'Do you hold RHCSA, MCSA or an equivalent certification?', answerType: 'yesno' }, { text: 'Have you administered a VMware or Hyper-V cluster?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Are you available for after-hours on-call support?', requiredAnswer: 'Yes' }]
  });

  const cands = await inBatches([
    ['Arnold Byaruhanga', 'M', '1990-03-15', 'MTN Uganda', 'Systems Engineer', 6, 'Red Hat Certified System Administrator (RHCSA)', 'Red Hat'],
    ['Sharon Nalwanga', 'F', '1992-07-11', 'Stanbic Bank Uganda', 'Server Administrator', 5, 'Microsoft Certified: Azure Administrator Associate', 'Microsoft'],
    ['Timothy Mugerwa', 'M', '1993-01-30', 'Uganda Revenue Authority', 'IT Officer', 4, 'VMware Certified Professional', 'VMware'],
    ['Faith Achan', 'F', '1994-10-08', 'Liquid Intelligent Technologies', 'NOC Engineer', 3, 'CCNA', 'Cisco']
  ].map(([name, sex, dob, employer, title, years, certName, org]) => ({
    name, sex, dob,
    education: [edu('Makerere University', 'Bachelors', 'Computer Science', 2016, 3.5)],
    work: [job(employer, title, years, null, ['Administered production Linux and Windows servers', 'Automated patching and backups'])],
    certs: [cert(certName, org, 2, 3)]
  })), 4, makeCandidate);
  const apps = {};
  for (const cand of cands) apps[cand.name] = await apply(cand, v);
  const [s1, s2, h1, r1] = cands;
  const ids = cands.map((cand) => apps[cand.name].id);
  await beginReview(v.id);
  await proposeShortlist(v.id, ids);
  await approveShortlist(v.id);
  const rounds = await scheduleSession(v.id, ids, {
    startsAt: at(workday(2), '10:00'), mode: 'Virtual', meetingLink: 'https://meet.example.com/ucaa-sysadmin-panel',
    instructions: 'Join from a quiet place with a working camera. The panel will share a short troubleshooting scenario on screen.',
    panelMembers: panel([['Patrick Mugisha', 'Manager Information Technology', true], ['Florence Akello', 'Human Resource Representative'], ['Brian Tumwesigye', 'Senior Systems Administrator']]),
    criteria: [{ name: 'Linux and Windows administration', weight: 3 }, { name: 'Networking and security', weight: 2 }, { name: 'Troubleshooting scenario', weight: 3 }, { name: 'Communication', weight: 1 }]
  });
  await shiftRounds(Object.values(rounds), 14);
  const R = (cand) => rounds[apps[cand.name].id];
  await hold(R(s1), [86, 82, 84], 'Shortlist');
  await hold(R(s2), [80, 78, 76], 'Shortlist');
  await hold(R(h1), [66, 62, 68], 'Hold');
  await hold(R(r1), [48, 52, 46], 'Reject', 'Limited server administration depth for this level.');
  const S = daysAgoOf(R(s1).scheduledDate) + 14;
  await proposeMerit(v.id, [s1, s2, h1].map((cand) => apps[cand.name].id));
  await retime(v.id, { created: S + 12, deadline: S + 4, review: S + 3, slProposed: S + 2.6, slApproved: S + 2.2, meritProposed: 1 });
  log(`  ${v.jobRef}: Arnold (Primary), Sharon + Timothy (Reserve) proposed; Faith rejected by the panel\n`);
  LIVE.push(`${v.jobRef} Systems Administrator - approve the proposed merit list [Principal HR Officer]`);
  return cands;
}

// Aviation Security Officer - the Interview Hub in full swing.
async function scenarioInterviews() {
  log('=== Aviation Security Officer (External) - interviews in progress ===');
  const v = await createVacancy({
    positionId: POS.avsec.id, reportsToPositionId: POS.avsecSenior.id,
    postingType: 'External', positionsRequired: 3, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U6 (UGX 1,900,000 - 2,500,000 per month)', minimumEducationLevel: 'Diploma', minimumExperienceYears: 1, minimumAge: 21, maximumAge: 35,
    requiredExamGrades: [{ level: 'OLevel', subject: 'English Language', minGrade: '6' }],
    jobPurpose: purpose('To protect civil aviation against acts of unlawful interference by screening passengers, baggage, cargo and staff at Entebbe International Airport.', [
      'Screen passengers and cabin baggage using X-ray and walk-through metal detectors', 'Control access to security-restricted areas', 'Patrol the airside perimeter and report breaches', 'Support contingency and bomb-threat drills'
    ]),
    essentialRequirements: ['Diploma in Security Studies, Criminology, Social Sciences or a related field', 'A credit in O-Level English Language', 'At least 1 year of security or law-enforcement experience'],
    desirableRequirements: [{ text: 'Do you hold an ICAO AVSEC Basic certificate?', answerType: 'yesno' }, { text: 'Have you operated X-ray screening equipment?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Are you willing to work rotating day and night shifts?', requiredAnswer: 'Yes' }, { text: 'Have you ever been convicted of a criminal offence?', requiredAnswer: 'No' }],
    specialSkills: ['Vigilance and attention to detail', 'Calm, courteous conduct with the public']
  });

  const cands = await inBatches([
    ['Frank Mugisha', 'M', '1996-06-12', 'Uganda Police Force', 'Police Constable', 4],
    ['Grace Nabirye', 'F', '1997-09-03', 'G4S Secure Solutions', 'Security Supervisor', 3],
    ['Hassan Lubega', 'M', '1995-01-20', 'Uganda People\'s Defence Forces', 'Private', 5],
    ['Janet Akiror', 'F', '1998-03-27', 'SGA Security', 'Guard Commander', 2],
    ['Moses Kyeyune', 'M', '1996-11-15', 'Ultimate Security', 'Security Officer', 3],
    ['Winnie Atuhaire', 'F', '1997-04-05', 'Kampala Capital City Authority', 'Law Enforcement Officer', 3],
    ['Ronald Ochen', 'M', '1995-08-19', 'Uganda Prisons Service', 'Warder', 4],
    ['Lydia Namatovu', 'F', '1998-12-01', 'Sheraton Kampala Hotel', 'Security Officer', 2],
    ['Samuel Okiror', 'M', '1996-02-23', 'Uganda Police Force', 'Police Constable', 3],
    ['Christine Apio', 'F', '1997-07-14', 'Serena Hotel Kampala', 'Loss Prevention Officer', 2],
    ['Paul Ssekandi', 'M', '1996-05-30', 'G4S Secure Solutions', 'Cash-in-Transit Guard', 3],
    ['Agnes Nakato', 'F', '1997-10-10', 'Uganda Wildlife Authority', 'Ranger', 3],
    ['Bosco Okello', 'M', '1984-03-02', 'Uganda Police Force', 'Corporal', 12]
  ].map(([name, sex, dob, employer, title, years], idx) => ({
    name, sex, dob, location: idx % 2 ? 'Entebbe, Uganda' : 'Kampala, Uganda',
    education: [edu(idx % 3 ? 'Nkumba University' : 'Uganda Martyrs University', 'Diploma', idx % 2 ? 'Criminology' : 'Security Studies', 2017)],
    work: [job(employer, title, years)],
    exams: [olevel('English Language', String(2 + (idx % 4))), olevel('Mathematics', String(3 + (idx % 4)))],
    certs: idx % 2 ? [] : [cert('ICAO AVSEC Basic', 'East African School of Aviation', 1, 3)]
  })), 4, makeCandidate);
  const apps = {};
  for (const [idx, cand] of cands.entries()) apps[cand.name] = await apply(cand, v, { strong: idx % 2 === 0 });
  const who = Object.fromEntries(cands.map((cand) => [cand.name.split(' ')[0], cand]));
  const A = (first) => apps[who[first].name].id;

  await beginReview(v.id);
  await reject(A('Bosco'), 'Above the maximum age of 35 set for this entry-level role at the application deadline.');
  await proposeShortlist(v.id, ['Frank', 'Grace', 'Hassan', 'Janet', 'Moses', 'Winnie', 'Ronald', 'Lydia', 'Samuel', 'Christine', 'Paul', 'Agnes'].map(A));
  await approveShortlist(v.id);

  const avsecPanel = panel([['Ronald Ssemwogerere', 'Manager Aviation Security', true], ['Diana Kyeyune', 'Human Resource Representative'], ['Moses Okiror', 'Principal AVSEC Officer']]);
  const rubric = [{ name: 'Security awareness and procedures', weight: 3 }, { name: 'Situational judgement', weight: 3 }, { name: 'Communication and customer care', weight: 2 }, { name: 'Integrity and conduct', weight: 2 }];
  const venue = { mode: 'In-person', location: 'AVSEC Training Centre, Entebbe International Airport', instructions: 'Bring your national ID and the original of your highest academic certificate. Dress code: smart casual.' };

  // Session A - took place last week.
  const heldNames = ['Frank', 'Grace', 'Hassan', 'Janet', 'Moses', 'Winnie', 'Ronald'];
  const held = await scheduleSession(v.id, heldNames.map(A), {
    startsAt: at(workday(1), '09:00'), ...venue,
    internalNotes: 'X-ray image interpretation test booked for 30 minutes after each interview.',
    panelMembers: avsecPanel, criteria: rubric
  });
  for (const first of heldNames) await respond(who[first], held[A(first)], 'Confirmed');
  await shiftRounds(Object.values(held), 7);
  const H = (first) => held[A(first)];
  // A panelist declared a conflict of interest for Frank before scoring.
  await api('PATCH', `/api/interviews/panel-members/${H('Frank').panelMembers[2].id}/recuse`, {
    token: T.shro, json: { reason: 'Declared a conflict of interest - the candidate is a relative.' }
  });
  await score(H('Frank'), { 0: 88, 1: 84 });
  await finalize(H('Frank'), 'Shortlist', 'Two-member panel after a recusal; both scored strongly.');
  await hold(H('Grace'), [82, 80, 86], 'Shortlist');
  await hold(H('Hassan'), [70, 66, 68], 'Hold', 'Adequate; keep in view if the top candidates decline.');
  await hold(H('Janet'), [44, 50, 42], 'Reject', 'Could not explain basic screening procedures.');
  await score(H('Moses'), { 0: 78, 1: 74, 2: 80 }); // all scores in - ready to finalize
  await score(H('Winnie'), { 0: 72 }); // two panelists still to score
  await api('POST', `/api/interviews/${H('Winnie').id}/access-links`, { token: T.shro });
  await api('PATCH', `/api/interviews/${H('Ronald').id}/no-show`, { token: T.shro, json: { notes: 'Did not arrive; phone unreachable on the day.' } });
  const S = daysAgoOf(H('Frank').scheduledDate) + 7;

  // Session B - later this week.
  const upcoming = await scheduleSession(v.id, ['Lydia', 'Samuel', 'Christine'].map(A), {
    startsAt: at(workday(3), '09:00'), ...venue, panelMembers: avsecPanel, criteria: rubric
  });
  await respond(who.Lydia, upcoming[A('Lydia')], 'Confirmed');
  await respond(who.Samuel, upcoming[A('Samuel')], 'RescheduleRequested', 'I sit my final diploma exam that morning - any time after 2pm, or the following Monday, would work.');

  // Ronald's second chance, online.
  const second = await scheduleOne(A('Ronald'), {
    scheduledDate: at(workday(4), '11:00'), mode: 'Virtual', meetingLink: 'https://meet.example.com/ucaa-avsec-panel',
    instructions: 'A second opportunity after the missed session - please join 5 minutes early.',
    panelMembers: avsecPanel.slice(0, 2), criteria: rubric
  });
  await respond(who.Ronald, second, 'Confirmed');

  // Paul: booked, then moved by HR.
  const paulRound = await scheduleOne(A('Paul'), { scheduledDate: at(workday(2), '14:00'), ...venue, panelMembers: avsecPanel, criteria: rubric });
  await api('PATCH', `/api/interviews/${paulRound.id}/reschedule`, {
    token: T.shro, json: { scheduledDate: at(workday(5), '14:00'), reason: 'The panel chair is travelling for an ICAO audit that day.', allowConflicts: true }
  });

  // Agnes: booked, then cancelled - back in the queue to be scheduled.
  const agnesRound = await scheduleOne(A('Agnes'), { scheduledDate: at(workday(2), '11:00'), mode: 'Phone', panelMembers: avsecPanel.slice(0, 2) });
  await api('PATCH', `/api/interviews/${agnesRound.id}/cancel`, {
    token: T.shro, json: { reason: 'Moving to the in-person format used for everyone else - to be re-booked.' }
  });

  await retime(v.id, { created: S + 14, deadline: S + 6, review: S + 5, slProposed: S + 4, slApproved: S + 3.5 });
  log(`  ${v.jobRef}: last week - Frank + Grace Shortlist, Hassan Hold, Janet Reject, Moses ready to finalize, Winnie awaiting 2 scores (links sent), Ronald no-show`);
  log('  coming up - Lydia confirmed, Samuel asked to reschedule, Christine not answered, Ronald round 2, Paul moved by HR; Agnes cancelled, awaiting a new slot; Bosco rejected at review\n');
  LIVE.push(`${v.jobRef} AVSEC Officer - finalize Moses Kyeyune, handle Samuel Okiror's reschedule request, re-book Agnes Nakato [Interview Hub, Senior HR Officer]`);
}

// Senior ATC Officer (Internal) - verification states and a proposed shortlist.
async function scenarioInternalShortlist() {
  log('=== Senior Air Traffic Control Officer (Internal) - shortlist awaiting approval ===');
  const v = await createVacancy({
    positionId: POS.atcSenior.id,
    postingType: 'Internal', positionsRequired: 1, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U3 (UGX 6,200,000 - 7,800,000 per month)', minimumEducationLevel: 'Diploma', minimumExperienceYears: 5,
    jobPurpose: purpose('To supervise a watch of the Entebbe approach and aerodrome control units and act as On-the-Job Training Instructor.', [
      'Supervise watch operations and staffing', 'Conduct on-the-job training and competency checks', 'Investigate and report ATS occurrences', 'Contribute to ATM safety cases'
    ]),
    essentialRequirements: ['Valid ATC licence with Aerodrome and Approach ratings', 'At least 5 years as a rated controller', 'Currently employed by UCAA'],
    desirableRequirements: [{ text: 'Do you hold an OJTI endorsement?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Do you hold a valid ICAO Class 3 medical certificate?', requiredAnswer: 'Yes' }]
  }, 'dhra');

  const internal = (name, sex, dob, employeeId, position, years, supervisor) => ({
    name, sex, dob, internal: true, location: 'Entebbe, Uganda',
    education: [edu('East African School of Aviation', 'Diploma', 'Air Traffic Services', 2010)],
    work: [job('Uganda Civil Aviation Authority', position, years, null, ['Aerodrome and approach control', 'Coordination with Nairobi and Kigali ACCs'])],
    certs: [cert('ATC Licence - Aerodrome and Approach ratings', 'Uganda Civil Aviation Authority', years - 1)],
    internalProfile: {
      employeeId, department: 'ATM', position, dateJoined: yearsAgo(years),
      supervisorName: supervisor, supervisorEmail: `${slug(supervisor)}@example.com`
    }
  });
  const cands = await inBatches([
    internal('David Ssekandi', 'M', '1985-04-18', 'UCAA-02114', 'Air Traffic Control Officer I', 9, 'Josephine Nabwire'),
    internal('Esther Auma', 'F', '1987-09-09', 'UCAA-02307', 'Air Traffic Control Officer I', 7, 'Josephine Nabwire'),
    internal('Quinn Ateenyi', 'M', '1988-01-26', 'UCAA-02452', 'Air Traffic Control Officer I', 6, 'Richard Opio'),
    internal('Rachel Nabatanzi', 'F', '1989-06-13', 'UCAA-02610', 'Air Traffic Control Officer II', 5, 'Richard Opio')
  ], 4, makeCandidate);
  const apps = {};
  for (const cand of cands) apps[cand.name] = await apply(cand, v);
  const [david, esther, quinn, rachel] = cands;
  await verifyInternal(david.id, 'HR_Verified', 'Employment, grade and ATC licence ratings confirmed against the HR file and the ATM roster.');
  await verifyInternal(esther.id, 'HR_Verified', 'Employment and grade confirmed with the ATM department; the licence copy on file is current.');
  await verifyInternal(rachel.id, 'Discrepancy_Flagged', 'Declared position is ATC Officer II but the HR file shows Assistant ATC Officer - referred to the supervisor.');
  await beginReview(v.id);
  await proposeShortlist(v.id, [apps[david.name].id, apps[esther.name].id]);
  await retime(v.id, { created: 21, deadline: 8, review: 7, slProposed: 2 });
  log(`  ${v.jobRef}: David + Esther (HR_Verified) proposed; ${quinn.name} Pending verification; Rachel Discrepancy_Flagged\n`);
  LIVE.push(`${v.jobRef} Senior ATC Officer (Internal) - approve the proposed shortlist [Principal HR Officer]; verify Quinn Ateenyi [Senior HR Officer]`);
}

// IT Support Officer - screened, ready to shortlist.
async function scenarioUnderReview(sysadminCandidates) {
  log('=== IT Support Officer (External) - screened, ready to shortlist ===');
  const v = await createVacancy({
    positionId: POS.itSupport.id, reportsToPositionId: POS.sysadmin.id,
    postingType: 'External', positionsRequired: 2, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U7 (UGX 1,500,000 - 2,100,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 1,
    preferredFieldOfStudy: 'Information Technology', minimumCGPA: 3.0,
    jobPurpose: purpose('To provide first- and second-line ICT support to UCAA staff at Entebbe International Airport and the Head Office.', [
      'Resolve hardware, software and network incidents through the service desk', 'Set up and maintain end-user devices and printers', 'Support airport flight-information display systems', 'Keep the IT asset register up to date'
    ]),
    essentialRequirements: ['Bachelor\'s degree in IT, Computer Science or a related field', 'At least 1 year of IT support experience'],
    desirableRequirements: [{ text: 'Do you hold CompTIA A+ or CCNA?', answerType: 'yesno' }, { text: 'How many years of service-desk experience do you have?', answerType: 'number', minValue: 2 }],
    disqualifyingRequirements: [{ text: 'Are you willing to work shifts, including weekends and public holidays?', requiredAnswer: 'Yes' }]
  });
  const [linda, nicholas, olivia, patrick, sandra] = await inBatches([
    { name: 'Linda Achieng', sex: 'F', dob: '1998-02-17', education: [edu('Makerere University', 'Bachelors', 'Information Technology', 2020, 3.8)], work: [job('MTN Uganda', 'IT Support Technician', 3)], certs: [cert('CompTIA A+', 'CompTIA', 2, 3)] },
    { name: 'Nicholas Kiwanuka', sex: 'M', dob: '1997-08-05', education: [edu('Kyambogo University', 'Bachelors', 'Computer Science', 2019, 3.4)], work: [job('Airtel Uganda', 'Service Desk Analyst', 4)] },
    { name: 'Olivia Nakimuli', sex: 'F', dob: '1999-05-22', education: [edu('Uganda Christian University', 'Bachelors', 'Information Systems', 2021, 3.2)], work: [job('Centenary Bank', 'IT Assistant', 2)] },
    { name: 'Patrick Mulindwa', sex: 'M', dob: '1998-10-30', education: [edu('Uganda Institute of Information and Communications Technology', 'Diploma', 'Computer Science', 2019)], work: [job('Computer Point Uganda', 'Technician', 5)] },
    { name: 'Sandra Nansamba', sex: 'F', dob: '1997-12-12', education: [edu('Makerere University', 'Bachelors', 'Information Technology', 2020, 3.6)], work: [job('Uganda Airlines', 'IT Support Officer', 3)] }
  ], 3, makeCandidate);
  await apply(linda, v);
  await apply(nicholas, v);
  await apply(olivia, v, { strong: false });
  const pat = await apply(patrick, v, { strong: false });
  await apply(sandra, v, { disq: { 0: false } });
  // Two of the Systems Administrator candidates applied here as well.
  await apply(sysadminCandidates[2], v);
  await apply(sysadminCandidates[3], v, { strong: false });
  await beginReview(v.id);
  await reject(pat.id, 'A Bachelor\'s degree is the minimum qualification for this role.');
  await retime(v.id, { created: 20, deadline: 7, review: 6 });
  log(`  ${v.jobRef}: 7 applications screened; Patrick rejected (below minimum education); Sandra failed the shift-work question\n`);
  LIVE.push(`${v.jobRef} IT Support Officer - rank and propose the interview shortlist [Senior HR Officer]`);
}

// AIS Officer - closed without an appointment, then readvertised.
async function scenarioClosedReadvertised() {
  log('=== Aeronautical Information Officer - closed and readvertised ===');
  const body = {
    postingType: 'External', positionsRequired: 1, employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U6 (UGX 2,000,000 - 2,600,000 per month)', minimumEducationLevel: 'Diploma', minimumExperienceYears: 2,
    jobPurpose: purpose('To collect, verify and publish aeronautical information (AIP, NOTAMs, charts) for Ugandan airspace.', [
      'Process and issue NOTAMs', 'Maintain the Uganda AIP and its amendments', 'Provide pre-flight information briefings', 'Support the AIM quality management system'
    ]),
    essentialRequirements: ['Diploma in Aeronautical Information Management or a related aviation field', 'At least 2 years in an AIS/AIM unit'],
    desirableRequirements: [{ text: 'Are you trained on an AIXM-based AIM system?', answerType: 'yesno' }],
    disqualifyingRequirements: []
  };
  const v = await createVacancy({ positionId: POS.ais.id, ...body, deadline: dateOnly(20) });
  const [tom, ruth] = await inBatches([
    { name: 'Tom Odongo', sex: 'M', dob: '1994-03-08', education: [edu('East African School of Aviation', 'Certificate', 'Aeronautical Information Services', 2018)], work: [job('Aviation Handling Services', 'Flight Operations Assistant', 1)] },
    { name: 'Ruth Kemigisha', sex: 'F', dob: '1993-11-19', education: [edu('East African School of Aviation', 'Diploma', 'Aeronautical Information Management', 2016)], work: [job('Kenya Airports Authority', 'AIS Officer', 5)] }
  ], 2, makeCandidate);
  const tomApp = await apply(tom, v, { strong: false });
  const ruthApp = await apply(ruth, v);
  await api('PATCH', `/api/applications/${ruthApp.id}/withdraw`, { token: ruth.token, json: { reason: 'I have accepted a promotion with my current employer.' } });
  await beginReview(v.id);
  await reject(tomApp.id, 'Does not meet the minimum Diploma qualification or the 2 years of AIS experience required.');
  await api('PATCH', `/api/vacancies/${v.id}/close`, { token: T.phro });
  await retime(v.id, { created: 26, deadline: 12, review: 11, rejected: 10.5 });

  const re = await api('POST', `/api/vacancies/${v.id}/readvertise`, { token: T.hro, json: { ...body, deadline: dateOnly(21), minimumExperienceYears: 1 } });
  await api('PATCH', `/api/vacancies/${re.id}/approve`, { token: T.manager });
  await retime(re.id, { created: 2 });
  log(`  ${v.jobRef} closed (one withdrawal, one rejection) -> readvertised as ${re.jobRef} asking 1 year's experience, now Open\n`);
}

// Fire Fighter - open and receiving applications.
async function scenarioOpen() {
  log('=== Fire Fighter (External) - open, receiving applications ===');
  const v = await createVacancy({
    positionId: POS.fireFighter.id, reportsToPositionId: POS.fireOfficer.id,
    postingType: 'External', positionsRequired: 4, deadline: dateOnly(18), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U8 (UGX 1,100,000 - 1,500,000 per month)', minimumEducationLevel: 'Certificate', minimumAge: 18, maximumAge: 28,
    jobPurpose: purpose('To provide aerodrome rescue and fire-fighting cover so that aircraft operations at Entebbe meet ICAO Category 9 requirements.', [
      'Respond to aircraft and domestic fire emergencies', 'Operate and maintain fire tenders and rescue equipment', 'Take part in daily drills and physical training', 'Carry out fire-safety inspections of airport premises'
    ]),
    essentialRequirements: ['Uganda Advanced Certificate of Education (UACE) and a certificate in fire safety or a related field', 'Aged 18 to 28 at the application deadline', 'Physically fit and able to pass a medical examination'],
    desirableRequirements: [{ text: 'Do you hold a valid driving permit?', answerType: 'yesno' }, { text: 'Have you completed a basic fire-fighting course?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Are you able to swim 50 metres unaided?', requiredAnswer: 'Yes' }]
  });
  const [isaac, mercy, kennedy, joan, robert, stella] = await inBatches([
    ['Isaac Waiswa', 'M', '2001-04-10'], ['Mercy Nakibuuka', 'F', '2002-09-18'], ['Kennedy Ojok', 'M', '2000-01-29'],
    ['Joan Asiimwe', 'F', '2001-06-03'], ['Robert Tumwine', 'M', '2002-11-21'], ['Stella Namubiru', 'F', '2000-08-14']
  ].map(([name, sex, dob]) => ({
    name, sex, dob, location: 'Entebbe, Uganda',
    education: [edu('Uganda Fire and Rescue Training School', 'Certificate', 'Fire Safety and Rescue', 2021)],
    work: [job('Entebbe Municipal Council', 'Casual Labourer', 2)],
    exams: [alevel('Physics', 'C'), alevel('Mathematics', 'D'), olevel('English Language', '4')]
  })), 3, makeCandidate);
  await apply(isaac, v);
  await apply(mercy, v);
  await apply(kennedy, v, { strong: false });
  await apply(joan, v);
  await apply(robert, v, { submit: false });
  const s = await apply(stella, v);
  await api('PATCH', `/api/applications/${s.id}/withdraw`, { token: stella.token, json: { reason: 'Relocating to Mbarara.' } });
  await retime(v.id, { created: 6 });
  log(`  ${v.jobRef}: 4 submitted, Robert still in draft, Stella withdrew\n`);
}

// Flight Operations Inspector - posted Internal, switched to External.
async function scenarioTransitioned() {
  log('=== Flight Operations Inspector - Internal -> External ===');
  const v = await createVacancy({
    positionId: POS.flightOps.id,
    postingType: 'Internal', positionsRequired: 1, deadline: dateOnly(10), employmentCategory: 'FixedTermContract', location: 'UCAA Head Office — Entebbe',
    salaryScale: 'U2 (UGX 9,000,000 - 11,500,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 5, minimumFlyingHours: 3000,
    jobPurpose: purpose('To certify and oversee air operators against the Civil Aviation (Operation of Aircraft) Regulations.', [
      'Conduct AOC certification and renewal inspections', 'Perform ramp and en-route inspections', 'Review operations manuals and training programmes', 'Investigate operational occurrences'
    ]),
    essentialRequirements: ['Bachelor\'s degree or an ATPL', 'At least 3,000 flight hours on multi-engine aircraft', 'At least 5 years in commercial air operations'],
    desirableRequirements: [{ text: 'Do you hold a type rating on a transport-category jet?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Do you hold, or have you held, an ATPL?', requiredAnswer: 'Yes' }]
  }, 'dhra');
  await api('PATCH', `/api/vacancies/${v.id}/transition-posting-type`, { token: T.manager, json: { postingType: 'External', deadline: dateOnly(24) } });
  const [pilot1, pilot2] = await inBatches([
    { name: 'Capt. Andrew Mukasa', sex: 'M', dob: '1978-05-04', flyingHours: 8200, education: [edu('Makerere University', 'Bachelors', 'Mechanical Engineering', 2000, 3.3)], work: [job('RwandAir', 'First Officer, B737', 14, 6), job('Uganda Airlines', 'Captain, CRJ-900', 6)], certs: [cert('Airline Transport Pilot Licence (ATPL)', 'Uganda Civil Aviation Authority', 12)] },
    { name: 'Capt. Miriam Nalubega', sex: 'F', dob: '1986-12-22', flyingHours: 2400, education: [edu('Soroti Flying School', 'Diploma', 'Commercial Pilot Training', 2009)], work: [job('Eagle Air', 'First Officer', 9)], certs: [cert('CPL with instrument rating', 'Uganda Civil Aviation Authority', 10)] }
  ], 2, makeCandidate);
  await apply(pilot1, v);
  await apply(pilot2, v, { strong: false });
  await retime(v.id, { created: 9, changed: 4 });
  log(`  ${v.jobRef}: no internal applicants -> switched to External by the Manager; 2 pilots applied (one short of 3,000 hours)\n`);
}

async function scenarioPendingApproval() {
  log('=== Vacancies awaiting approval ===');
  const acc = await createVacancy({
    positionId: POS.accountant.id, reportsToPositionId: POS.seniorAccountant.id,
    postingType: 'External', positionsRequired: 2, deadline: dateOnly(28), employmentCategory: 'FullTime', location: 'UCAA Head Office — Entebbe',
    salaryScale: 'U6 (UGX 2,000,000 - 2,600,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 2,
    jobPurpose: purpose('To process payments, receipts and reconciliations for the Finance department.', ['Process supplier payments', 'Reconcile aeronautical revenue', 'Prepare VAT and PAYE returns']),
    essentialRequirements: ['Bachelor\'s degree in Accounting or Finance', 'CPA or ACCA (at least part-qualified)'],
    desirableRequirements: [{ text: 'Are you a full member of ICPAU?', answerType: 'yesno' }],
    disqualifyingRequirements: []
  }, null);
  await prisma.vacancy.update({ where: { id: acc.id }, data: { createdAt: ago(3) } });
  const hr = await createVacancy({
    positionId: POS.hrOfficer.id,
    postingType: 'Internal', positionsRequired: 1, deadline: dateOnly(21), employmentCategory: 'FullTime', location: 'UCAA Head Office — Entebbe',
    salaryScale: 'U6 (UGX 2,000,000 - 2,600,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 2,
    jobPurpose: purpose('To support recruitment, onboarding and staff records for the Directorate of Human Resource and Administration.', ['Coordinate recruitment logistics', 'Maintain personnel files', 'Support the performance-management cycle']),
    essentialRequirements: ['Bachelor\'s degree in Human Resource Management or a related field', 'Currently employed by UCAA'],
    desirableRequirements: [], disqualifyingRequirements: []
  }, null);
  log(`  ${acc.jobRef} Accountant (3 days old - past its approval SLA), ${hr.jobRef} HR Officer (Internal)\n`);
  LIVE.push(`${acc.jobRef} Accountant and ${hr.jobRef} HR Officer - approve the vacancies [Manager/Director]`);
}

// ---------------------------------------------------------------------------
// Finishing touches
// ---------------------------------------------------------------------------

async function finish() {
  // Candidates registered a day or so before their first application.
  const candidates = await prisma.candidate.findMany({ include: { applications: { select: { createdAt: true } } } });
  for (const c of candidates) {
    const first = Math.min(...c.applications.map((a) => a.createdAt.getTime()), NOW);
    const created = new Date(first - (1 + (c.id % 3)) * DAY);
    await prisma.candidate.update({
      where: { id: c.id },
      data: { createdAt: created, profileCompletedAt: c.profileCompletedAt ? new Date(created.getTime() + 2 * 60 * 60 * 1000) : null }
    });
  }

  log('=== Maintenance jobs (SLA escalations, deadline notices, interview reminders, offer expiry) ===');
  for (const name of ['checkSlaEscalations', 'checkVacancyDeadlines', 'sendInterviewReminders', 'expireOffers', 'cleanupPendingRegistrations', 'cleanupVerificationTokens']) {
    const mod = require(`./${name}`);
    await runJob(name, () => mod.run());
  }

  // Staff inboxes: routine notices read, anything that asks for action unread.
  const ACTIONABLE = ['VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'MeritListProposed', 'OfferReturned',
    'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'OfferDeclined', 'OfferExpired', 'VacancyDeadlinePassed'];
  await prisma.notification.updateMany({ where: { taskType: { notIn: ACTIONABLE } }, data: { readAt: new Date() } });
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  try {
    if (await prisma.vacancy.count() || await prisma.candidate.count()) {
      throw new Error('The database already has vacancies or candidates - run `node scripts/resetDemoData.js --yes` first.');
    }
    if (!await prisma.directorate.count()) throw new Error('No directorates - run scripts/seedDepartments.js (resetDemoData.js does) first.');
    await loginStaff();
    await seedOrg();
    await scenarioFilled();
    await scenarioDeclineExpire();
    await scenarioOffers();
    const sysadminCandidates = await scenarioMeritProposed();
    await scenarioInterviews();
    await scenarioInternalShortlist();
    await scenarioUnderReview(sysadminCandidates);
    await scenarioClosedReadvertised();
    await scenarioOpen();
    await scenarioTransitioned();
    await scenarioPendingApproval();
    await finish();

    log('\n=== Done ===');
    log(`${await prisma.vacancy.count()} vacancies, ${await prisma.candidate.count()} candidates, ${await prisma.application.count()} applications, `
      + `${await prisma.interviewRound.count()} interview rounds, ${await prisma.offer.count()} offers.`);
    log('\nLeft for live actions:');
    for (const line of LIVE) log(`  - ${line}`);
    log('  - SMS department (DSSER) - approve or reject it [Principal HR Officer]');
    log(`\nStaff password: ${STAFF_PASSWORD}   Candidate password: ${PASSWORD}`);
    log('External candidates sign in as firstname.lastname@example.com, internal ones as demo.firstname.lastname@caa.co.ug.');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nSEED FAILED:', e);
  process.exitCode = 1;
});
