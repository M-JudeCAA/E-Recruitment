// Demo-data seeder that populates an EMPTY database (after
// scripts/resetDemoData.js) with vacancies at every stage of the current
// selection workflow - vacancy approval; applications with academic documents,
// screened at the point of application (ineligible candidates are left as
// refused drafts); the shortlisting committee (setup, blind rating,
// moderation with chair and acting-chair rulings, closing, proposing from
// the ranking); the Interview Hub (sessions run on the day, candidates called
// in, rubrics, panel scoring, recusal, no-shows, reschedules, cancellations,
// and a session booked for today to run live); the post-interview merit list;
// and the full offer lifecycle (returned/revised, issued, accepted, declined,
// expired, withdrawn, with reserve promotion) - leaving real actions for each
// staff tier, committee member, panelist and candidate to perform live.
//
// Drives the real API (every business rule runs) by starting the Express app
// in-process on a free port with SMTP_HOST=json, so no email leaves the
// machine. Direct DB access is used only where the API has no way in: reading
// email-confirmation tokens and committee members' link tokens, and
// back-dating timestamps so the history reads like weeks of real work rather
// than one run.
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
const { frontendUrl } = require('../src/config/frontendUrl');
const { createVacancyFromRequisition } = require('./lib/demoVacancy');

const PASSWORD = 'DemoPass123!';
const STAFF_PASSWORD = 'ChangeMe123!';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
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
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const ago = (days) => new Date(NOW - days * DAY);
const daysAgoOf = (date) => (NOW - new Date(date).getTime()) / DAY;

function klaDate(date) {
  return new Date(new Date(date).getTime() + 3 * HOUR).toISOString().slice(0, 10);
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
const STAFF_ID = {};

async function loginStaff() {
  for (const [key, email] of Object.entries(STAFF_EMAILS)) {
    const r = await api('POST', '/api/staff/auth/login', { json: { email, password: STAFF_PASSWORD } });
    T[key] = r.token;
    STAFF_ID[key] = (await prisma.staffUser.findUnique({ where: { email } })).id;
  }
}

// ---------------------------------------------------------------------------
// Documents - small but real PDFs, so HR and committee members can open them
// ---------------------------------------------------------------------------

function pdfDocument(title, lines) {
  const esc = (s) => String(s).replace(/[^\x20-\x7e]/g, '-').replace(/[\\()]/g, (m) => `\\${m}`);
  const text = [
    `BT /F1 18 Tf 60 780 Td (${esc(title)}) Tj ET`,
    ...lines.map((l, i) => `BT /F1 11 Tf 60 ${740 - i * 20} Td (${esc(l)}) Tj ET`),
    'BT /F1 8 Tf 60 60 Td (Demonstration document generated for the UCAA e-Recruitment system.) Tj ET'
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function uploadDocument(c, applicationId, category, label, title, lines) {
  const form = new FormData();
  form.append('category', category);
  form.append('label', label);
  form.append('file', new Blob([pdfDocument(title, lines)], { type: 'application/pdf' }), `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  return api('POST', `/api/applications/${applicationId}/documents`, { token: c.token, form });
}

// The candidate's academic documents (their highest qualification, plus a
// transcript for a degree), and sometimes a copy of their national ID.
async function attachDocuments(c, applicationId) {
  const e = c.education[0];
  await uploadDocument(c, applicationId, 'Academic', `${e.qualificationLevel} certificate`, `${e.institution}`, [
    'This is to certify that', c.name, `was awarded a ${e.qualificationLevel} in ${e.fieldOfStudy}`, `in the year ${e.yearCompleted}.`
  ]);
  if (['Bachelors', 'Masters'].includes(e.qualificationLevel)) {
    await uploadDocument(c, applicationId, 'Academic', 'Academic transcript', `${e.institution} - Academic transcript`, [
      `Student: ${c.name}`, `Programme: ${e.qualificationLevel} of ${e.fieldOfStudy}`,
      e.cgpa ? `Cumulative grade point average: ${e.cgpa} / 5.0` : 'Classification: Pass', `Completed: ${e.yearCompleted}`
    ]);
  }
  for (const cert of (c.certs || []).slice(0, 1)) {
    await uploadDocument(c, applicationId, 'Other', cert.name, cert.issuingOrganization, [`Awarded to ${c.name}`, cert.name, `Issued ${cert.issueDate}`]);
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
      nationalId: nid, location: spec.location || 'Kampala, Uganda',
      districtOfOrigin: spec.districtOfOrigin || ['Wakiso', 'Mukono', 'Gulu', 'Mbarara', 'Jinja', 'Mbale'][n % 6],
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
// submit: true (must go through), false (left as a draft), or 'refused' (the
// candidate tries, and the eligibility check at submission turns them away -
// the draft stays, exactly as it would for a real applicant).
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
  await attachDocuments(c, draft.id);
  if (!submit) return draft;
  try {
    const submitted = await api('PATCH', `/api/applications/${draft.id}/submit`, { token: c.token, json: { consent: true } });
    if (submit === 'refused') throw new Error(`${c.name} was expected to be refused at submission for ${vacancy.title}, but was accepted`);
    return submitted;
  } catch (err) {
    if (submit === 'refused' && err.body?.code === 'NOT_ELIGIBLE') return { ...draft, refusedReasons: err.body.reasons };
    throw err;
  }
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
  // From an uploaded EXCO requisition, the only way a vacancy can be created.
  const v = await createVacancyFromRequisition(api, T.hro, body);
  if (approver) await api('PATCH', `/api/vacancies/${v.id}/approve`, { token: T[approver] });
  return v;
}

const beginReview = (vacancyId) => api('PATCH', `/api/vacancies/${vacancyId}/begin-review`, { token: T.shro });
const reject = (applicationId, reason) => api('PATCH', `/api/applications/${applicationId}/reject`, { token: T.shro, json: { reason } });
const approveShortlist = (vacancyId) => api('POST', `/api/applications/vacancies/${vacancyId}/approve-shortlist`, { token: T.phro });

async function verifyInternal(candidateId, decision, comments) {
  const form = new FormData();
  form.append('decision', decision);
  form.append('comments', comments);
  return api('PATCH', `/api/verification/candidates/${candidateId}/verify`, { token: T.shro, form });
}

// The application window closes - rating can only open after the deadline.
// (retime() later sets the deadline the history should show.)
const closeApplications = (vacancyId) => prisma.vacancy.update({ where: { id: vacancyId }, data: { deadline: ago(0.2) } });

// ---------------------------------------------------------------------------
// Shortlisting committee
// ---------------------------------------------------------------------------

const DESIRABLE_BASE = { strong: 5, good: 4, fair: 3, weak: 2 };

// One member's ratings of one applicant. profile: strong | good | fair | weak;
// notMet: the index of an essential criterion the majority find not met;
// dispute: the index of an essential criterion the raters split on
// (Met / Partly / Not met), which the chair must then settle.
function ratingsFor(criteria, { profile = 'good', notMet = null, dispute = null }, memberIdx, salt) {
  const essentials = criteria.filter((c) => c.kind === 'Essential');
  return criteria.map((c, i) => {
    if (c.kind === 'Essential') {
      const e = essentials.indexOf(c);
      if (dispute === e) {
        const value = [2, 1, 0][memberIdx % 3];
        return { criterionId: c.id, value, comment: value === 0 ? 'The application does not show this clearly enough for me to accept it.' : null };
      }
      if (notMet === e && memberIdx % 3 !== 2) {
        return { criterionId: c.id, value: 0, comment: 'Not demonstrated in the application or the documents provided.' };
      }
      if (profile === 'fair' && e === 0 && memberIdx === 1) return { criterionId: c.id, value: 1, comment: 'Only partly shown.' };
      return { criterionId: c.id, value: 2, comment: null };
    }
    const wobble = (memberIdx + i + salt) % 3 === 0 ? -1 : 0;
    return { criterionId: c.id, value: Math.min(5, Math.max(1, DESIRABLE_BASE[profile] + wobble)), comment: null };
  });
}

const committeeMember = (name, role, isChair) => ({ name, role, email: `${slug(name)}@example.com`, isChair: !!isChair });

// Runs the committee for a vacancy up to `stopAt` (Setup | Rating | Moderation
// | Closed | Proposed). profiles: { applicationId: { profile, notMet, dispute } }.
// conflicts: [[memberIdx, applicationId, reason]]. partial: { memberIdx: n
// applicants rated } for members who haven't submitted. rulings: [{
// applicationId, criterion (essential index), outcome, reason, byMemberIdx }].
async function runCommittee(vacancy, members, {
  profiles = {}, conflicts = [], partial = {}, actingChairs = [], rulings = [], stopAt = 'Proposed', proposeCount, ratersPerApplicant
} = {}) {
  const base = `/api/shortlist-committee/vacancies/${vacancy.id}`;
  await api('POST', base, { token: T.shro });
  if (ratersPerApplicant) await api('PATCH', base, { token: T.shro, json: { ratersPerApplicant } });
  for (const m of members) await api('POST', `${base}/members`, { token: T.shro, json: { name: m.name, email: m.email, isChair: m.isChair } });
  if (stopAt === 'Setup') return null;

  await closeApplications(vacancy.id);
  await api('POST', `${base}/open`, { token: T.shro });
  const exercise = await prisma.shortlistExercise.findUnique({ where: { vacancyId: vacancy.id }, include: { members: { orderBy: { id: 'asc' } } } });
  const rows = exercise.members;
  const criteria = exercise.criteria;

  for (const [idx, member] of rows.entries()) {
    const view = await api('GET', `/api/shortlist-panel/${member.token}`);
    const limit = idx in partial ? partial[idx] : view.applicants.length;
    for (const [k, a] of view.applicants.entries()) {
      const conflict = conflicts.find(([mi, appId]) => mi === idx && appId === a.applicationId);
      if (conflict) {
        await api('POST', `/api/shortlist-panel/${member.token}/applicants/${a.applicationId}/conflict`, { json: { reason: conflict[2] } });
        continue;
      }
      if (k >= limit) continue;
      await api('PUT', `/api/shortlist-panel/${member.token}/applicants/${a.applicationId}/ratings`, {
        json: { ratings: ratingsFor(criteria, profiles[a.applicationId] || {}, idx, a.applicationId) }
      });
    }
    if (!(idx in partial)) await api('POST', `/api/shortlist-panel/${member.token}/submit`);
  }
  for (const { applicationId, memberIdx } of actingChairs) {
    await api('PUT', `${base}/acting-chairs`, { token: T.shro, json: { applicationId, memberId: rows[memberIdx].id } });
  }
  if (stopAt === 'Rating') return { exercise, members: rows };

  await api('POST', `${base}/moderation`, { token: T.shro, json: { force: true } });
  if (stopAt === 'Moderation') return { exercise, members: rows };

  const essentials = criteria.filter((c) => c.kind === 'Essential');
  for (const r of rulings) {
    const by = rows[r.byMemberIdx ?? rows.findIndex((m) => m.isChair)];
    await api('PUT', `/api/shortlist-panel/${by.token}/decisions`, {
      json: { applicationId: r.applicationId, criterionId: essentials[r.criterion].id, outcome: r.outcome, reason: r.reason }
    });
  }
  await api('POST', `${base}/close`, { token: T.shro });
  if (stopAt === 'Closed') return { exercise, members: rows };
  const proposed = await api('POST', `${base}/propose`, { token: T.shro, json: { count: proposeCount } });
  return { exercise, members: rows, proposed: proposed.applicationIds };
}

// The committee's milestones, back-dated (days ago).
async function retimeCommittee(vacancyId, { created, opened, moderation, closed }) {
  const ex = await prisma.shortlistExercise.findUnique({ where: { vacancyId }, include: { members: { orderBy: { id: 'asc' } } } });
  if (!ex) return;
  const data = { createdAt: ago(created) };
  if (ex.ratingOpenedAt) data.ratingOpenedAt = ago(opened);
  if (ex.moderationStartedAt) data.moderationStartedAt = ago(moderation);
  if (ex.closedAt) data.closedAt = ago(closed);
  await prisma.shortlistExercise.update({ where: { id: ex.id }, data });
  const end = moderation ?? 0.2;
  for (const [i, m] of ex.members.entries()) {
    await prisma.shortlistMember.update({ where: { id: m.id }, data: { createdAt: ago(created - 0.05) } });
    if (!m.submittedAt) continue;
    const when = ago(opened - ((opened - end) * (i + 1)) / (ex.members.length + 1));
    await prisma.shortlistMember.update({ where: { id: m.id }, data: { submittedAt: when } });
    await prisma.shortlistRating.updateMany({ where: { assignment: { memberId: m.id } }, data: { updatedAt: when } });
  }
  if (moderation != null) {
    await prisma.shortlistDecision.updateMany({ where: { exerciseId: ex.id }, data: { decidedAt: ago(Math.max(0.05, (closed ?? moderation) + 0.2)) } });
  }
}

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

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
// The panelists' day links move to the new day with them.
async function shiftRounds(vacancyId, rounds, days) {
  const moved = new Map();
  for (const round of rounds) {
    const from = new Date(round.scheduledDate);
    const to = new Date(from.getTime() - days * DAY);
    moved.set(klaDate(from), klaDate(to));
    await prisma.interviewRound.update({ where: { id: round.id }, data: { scheduledDate: to } });
  }
  for (const [from, to] of moved) {
    await prisma.panelDayLink.updateMany({ where: { vacancyId, day: from }, data: { day: to } });
  }
}

// Every past interview day of a vacancy as HR ran it: the session started
// just before the first interview and ended after the last, with each
// candidate who attended called in.
async function recordHeldDays(vacancyId) {
  const rounds = await prisma.interviewRound.findMany({
    where: { application: { vacancyId }, scheduledDate: { lt: new Date(NOW) }, status: { not: 'Cancelled' } },
    orderBy: { scheduledDate: 'asc' }
  });
  const byDay = new Map();
  for (const r of rounds) {
    const day = klaDate(r.scheduledDate);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  for (const [day, list] of byDay) {
    const first = new Date(list[0].scheduledDate).getTime();
    const last = Math.max(...list.map((r) => new Date(r.scheduledDate).getTime() + (r.durationMinutes || 60) * MINUTE));
    await prisma.interviewDay.upsert({
      where: { vacancyId_day: { vacancyId, day } },
      update: {},
      create: {
        vacancyId, day,
        startedAt: new Date(first - 15 * MINUTE), startedById: STAFF_ID.shro,
        endedAt: new Date(last + 10 * MINUTE), endedById: STAFF_ID.shro, closesAt: new Date(last + 25 * MINUTE),
        createdAt: new Date(first - 15 * MINUTE)
      }
    });
    for (const r of list.filter((x) => x.status !== 'NoShow')) {
      await prisma.interviewRound.update({
        where: { id: r.id }, data: { calledInAt: new Date(new Date(r.scheduledDate).getTime() - 2 * MINUTE), calledInById: STAFF_ID.shro }
      });
    }
  }
}

const respond = (c, round, response, note) => api('PATCH', `/api/candidates/me/interviews/${round.id}/respond`, { token: c.token, json: { response, note } });

// Ratings (1-5) per rubric criterion that land near a 0-100 target.
function rubricRatings(criteria, target, salt) {
  const wobble = [0, 0.4, -0.4, 0.2, -0.2];
  return Object.fromEntries(criteria.map((c, i) => [c.id, Math.min(5, Math.max(1, Math.round(target / 20 + wobble[(i + salt) % wobble.length])))]));
}

const COMMENTS = {
  high: ['Excellent command of the subject; answered the scenario questions with confidence.', 'Strong, structured answers and clear safety awareness.', 'Very well prepared - the best technical depth on the day.'],
  mid: ['Solid fundamentals, some hesitation on the regulatory questions.', 'Good communicator; technical answers adequate but not deep.', 'Capable candidate who would benefit from more hands-on exposure.'],
  low: ['Struggled with the core technical questions.', 'Answers were generic and lacked practical examples.', 'Limited understanding of what the role requires.']
};

// Scores recorded by HR on the panelists' behalf: { panelIndex: target 0-100 }.
async function score(round, targets) {
  for (const [idx, target] of Object.entries(targets)) {
    const m = round.panelMembers[idx];
    const salt = Number(idx) + round.id;
    const band = target >= 75 ? 'high' : target >= 55 ? 'mid' : 'low';
    await api('PATCH', `/api/interviews/panel-members/${m.id}/score`, {
      token: T.shro,
      json: round.criteria
        ? { criterionScores: rubricRatings(round.criteria, target, salt), comments: COMMENTS[band][salt % 3] }
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

// ---------------------------------------------------------------------------
// Merit list and offers
// ---------------------------------------------------------------------------

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

  const apps = await prisma.application.findMany({ where: { vacancyId }, orderBy: { id: 'asc' }, include: { interviewRounds: true, documents: true } });
  const from = t.created - 1.1;
  const to = t.deadline != null && t.deadline > 0 ? t.deadline + 0.3 : 0.2;
  for (let i = 0; i < apps.length; i += 1) {
    const a = apps[i];
    const sub = from - ((from - to) * (i + 1)) / (apps.length + 1);
    const d = { createdAt: ago(sub + 0.08) };
    if (a.submittedDate) d.submittedDate = ago(sub);
    if (a.screenedAt) d.screenedAt = ago(t.review != null ? Math.min(t.review, sub - 0.001) : sub - 0.001);
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
    await prisma.applicationDocument.updateMany({ where: { applicationId: a.id }, data: { uploadedAt: ago(sub + 0.05) } });

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
        data: { submittedAt: new Date(when + 3 * HOUR) }
      });
    }
  }
  await prisma.panelDayLink.updateMany({ where: { vacancyId }, data: { createdAt: ago(t.slApproved != null ? t.slApproved - 0.3 : 0.1) } });
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
    ['avsecManager', 'Manager Aviation Security', 'AVSEC/DAAS', 3],
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

  await api('POST', '/api/delegations', {
    token: T.phro,
    json: { delegateId: STAFF_ID.shro, startDate: dateOnly(-2), endDate: dateOnly(5), reason: 'Covering Principal HR Officer approvals during annual leave.' }
  });
  log('  Delegation: Principal HR Officer -> Senior HR Officer (active this week)\n');
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const purpose = (summary, duties) => `<p>${summary}</p><p><strong>Principal accountabilities</strong></p><ul>${duties.map((d) => `<li>${d}</li>`).join('')}</ul>`;
const LIVE = [];

const COMMITTEES = {
  finance: [committeeMember('Christine Namutebi', 'Manager Finance', true), committeeMember('Joel Byamugisha', 'Principal Accountant'), committeeMember('Sarah Achola', 'Manager Internal Audit')],
  fire: [committeeMember('Samuel Wandera', 'Chief Fire Officer', true), committeeMember('Isaac Ochieng', 'Station Officer, ARFFS'), committeeMember('Peter Kalule', 'Aerodrome Safety Manager')],
  atc: [committeeMember('Stephen Tumwine', 'Director Air Navigation Services', true), committeeMember('Josephine Nabwire', 'Manager Air Traffic Management'), committeeMember('Richard Opio', 'Senior Air Traffic Control Officer')],
  it: [committeeMember('Patrick Mugisha', 'Manager Information Technology', true), committeeMember('Brian Tumwesigye', 'Senior Systems Administrator'), committeeMember('Irene Kobusingye', 'Principal Systems Analyst')],
  avsec: [committeeMember('Ronald Ssemwogerere', 'Manager Aviation Security', true), committeeMember('Moses Okiror', 'Principal AVSEC Officer'), committeeMember('Harriet Namaganda', 'Airport Manager, Entebbe')]
};

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
    essentialRequirements: ['Full professional qualification (CPA, ACCA or CIMA)', 'Experience preparing IFRS financial statements'],
    desirableRequirements: [{ text: 'Do you have experience with an ERP system (SAP, Oracle or Microsoft Dynamics)?', answerType: 'yesno' }, { text: 'Are you a full member of ICPAU?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Do you hold a full professional accounting qualification (CPA/ACCA/CIMA)?', requiredAnswer: 'Yes' }],
    specialSkills: ['Advanced Excel and financial modelling']
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
  await runCommittee(v, COMMITTEES.finance, {
    profiles: { [ax.id]: { profile: 'strong' }, [ay.id]: { profile: 'good' }, [az.id]: { profile: 'fair' } }, proposeCount: 3
  });
  await approveShortlist(v.id);

  const rounds = await scheduleSession(v.id, [ax.id, ay.id, az.id], {
    startsAt: at(workday(2), '09:00'), mode: 'In-person', location: 'Board Room, UCAA Head Office — Entebbe',
    instructions: 'Please bring the originals of your academic and professional certificates.',
    panelMembers: panel([['Christine Namutebi', 'Manager Finance', true], ['Florence Akello', 'Human Resource Representative'], ['Joel Byamugisha', 'Principal Accountant']]),
    criteria: [{ name: 'Technical accounting (IFRS, PFMA)', weight: 3 }, { name: 'Analysis and problem solving', weight: 2 }, { name: 'Communication', weight: 2 }, { name: 'Leadership and integrity', weight: 2 }]
  });
  await shiftRounds(v.id, Object.values(rounds), 21);
  await hold(rounds[ax.id], [86, 82, 88], 'Shortlist');
  await hold(rounds[ay.id], [78, 80, 74], 'Shortlist');
  await hold(rounds[az.id], [52, 48, 56], 'Reject', 'Did not show the IFRS knowledge expected at senior level.');
  await recordHeldDays(v.id);
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

  await retime(v.id, { created: S + 18, deadline: S + 9, review: S + 8.5, slProposed: S + 3.5, slApproved: S + 3, meritProposed: S - 2, meritApproved: S - 2.5 });
  await retimeCommittee(v.id, { created: S + 8.4, opened: S + 8, moderation: S + 4.5, closed: S + 4 });
  await offerDates(ox.id, { recommended: S - 3, decided: S - 4 });
  await offerDates(oy.id, { recommended: S - 4.5, approved: S - 5.5, decided: S - 8 });
  await prisma.vacancy.update({ where: { id: v.id }, data: { filledAt: ago(S - 8) } });
  log(`  ${v.jobRef}: committee ranked 3 -> all interviewed; Rebecca's offer withdrawn -> Emmanuel promoted, offered, accepted -> Filled\n`);
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
    essentialRequirements: ['At least 1 year leading a fire crew', 'Valid Class CE driving permit'],
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
  await runCommittee(v, COMMITTEES.fire, {
    profiles: {
      [apps[g.name].id]: { profile: 'strong' }, [apps[i.name].id]: { profile: 'strong' }, [apps[h.name].id]: { profile: 'good' },
      [apps[k.name].id]: { profile: 'good' }, [apps[j.name].id]: { profile: 'fair', dispute: 3 }
    },
    rulings: [{ applicationId: apps[j.name].id, criterion: 3, outcome: 'Met', reason: 'Her TotalEnergies role included leading the site fire team on shift - accepted as crew-leading experience.' }],
    proposeCount: 5
  });
  await approveShortlist(v.id);

  const rounds = await scheduleSession(v.id, ids, {
    startsAt: at(workday(1), '09:00'), mode: 'In-person', location: 'ARFFS Main Fire Station, Entebbe', durationMinutes: 60,
    instructions: 'Wear sports attire - the interview includes a 20-minute practical rescue drill.',
    panelMembers: panel([['Samuel Wandera', 'Chief Fire Officer', true], ['Agnes Nakiwala', 'Human Resource Representative'], ['Isaac Ochieng', 'Station Officer, ARFFS']]),
    criteria: [{ name: 'Incident command', weight: 3 }, { name: 'Practical drill', weight: 3 }, { name: 'ARFF regulations (ICAO Annex 14)', weight: 2 }, { name: 'Communication', weight: 1 }]
  });
  await shiftRounds(v.id, Object.values(rounds), 21);
  const R = (c) => rounds[apps[c.name].id];
  await hold(R(g), [88, 85, 90], 'Shortlist');
  await hold(R(i), [84, 80, 82], 'Shortlist');
  await hold(R(h), [76, 78, 72], 'Shortlist');
  await hold(R(k), [72, 70, 74], 'Shortlist');
  await hold(R(j), [64, 60, 66], 'Hold', 'Good potential; limited crew-leading experience.');
  await recordHeldDays(v.id);
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
  await prisma.offer.update({ where: { id: oi.id }, data: { decidedAt: new Date(expired.responseDeadline.getTime() + HOUR) } });

  const oh = await recommendOffer(apps[h.name].id, terms);
  await approveOffer(oh.id);
  await offerDates(oh.id, { recommended: S - 8.5, approved: S - 9.5 });

  await retime(v.id, { created: S + 18, deadline: S + 9, review: S + 8.5, slProposed: S + 3.5, slApproved: S + 3, meritProposed: S - 2, meritApproved: S - 2.5 });
  await retimeCommittee(v.id, { created: S + 8.4, opened: S + 8, moderation: S + 4.5, closed: S + 4 });
  log(`  ${v.jobRef}: committee split on Josephine, chair ruled; Geoffrey declined -> Henry promoted and offered (awaiting answer); Irene's offer expired -> Kenneth promoted\n`);
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
    essentialRequirements: ['Able to obtain an ICAO Class 3 medical certificate'],
    desirableRequirements: [{ text: 'Do you hold an ATC licence or student ATC licence?', answerType: 'yesno' }, { text: 'What is your ICAO English Language Proficiency level (1-6)?', answerType: 'number', minValue: 4 }],
    disqualifyingRequirements: [{ text: 'Are you willing to work rostered night and weekend shifts?', requiredAnswer: 'Yes' }],
    generalKnowledge: ['ICAO Annex 11 and Doc 4444'], specialSkills: ['Clear radiotelephony']
  });

  const cands = await inBatches([
    ['Brenda Namuli', 'F', '1996-04-09', 'Physics', 3.8, 'Uganda Airlines', 'Flight Dispatcher'],
    ['Daniel Opolot', 'M', '1995-10-22', 'Aeronautical Engineering', 3.9, 'Eagle Air', 'Operations Officer'],
    ['Esther Nabwire', 'F', '1997-02-14', 'Mathematics', 3.6, 'Entebbe Handling Services', 'Load Controller'],
    ['Allan Mwesigwa', 'M', '1996-07-03', 'Aviation Management', 3.5, 'Kenya Airways (Entebbe)', 'Station Agent'],
    ['Patience Kyomuhendo', 'F', '1995-12-19', 'Physics', 3.4, 'Uganda National Meteorological Authority', 'Weather Observer'],
    ['Ivan Ssebunya', 'M', '1996-09-28', 'Electrical Engineering', 3.3, 'Aviation Handling Services', 'Ramp Supervisor'],
    ['Collins Wafula', 'M', '1997-05-06', 'Computer Science', 3.1, 'Jambojet', 'Customer Service Agent'],
    ['Nathan Kizza', 'M', '1996-01-15', 'Statistics', 3.2, 'Uganda Bureau of Statistics', 'Data Clerk']
  ].map(([name, sex, dob, field, cgpa, employer, title]) => ({
    name, sex, dob,
    education: [edu(field.includes('Aviation') ? 'Kyambogo University' : 'Makerere University', 'Bachelors', field, 2018, cgpa)],
    work: [job(employer, title, 4)],
    exams: [alevel('Mathematics', cgpa > 3.5 ? 'A' : 'B'), alevel('Physics', cgpa > 3.5 ? 'B' : 'C'), olevel('English Language', '2')]
  })), 4, makeCandidate);
  const [a, b, c, d, e, f, x, nathan] = cands;
  const apps = {};
  for (const cand of cands) apps[cand.name] = await apply(cand, v, { strong: ![x, nathan].includes(cand) });
  const interviewees = [a, b, c, d, e, f, x];
  const ids = interviewees.map((cand) => apps[cand.name].id);
  await beginReview(v.id);
  const profiles = Object.fromEntries(interviewees.map((cand, idx) => [apps[cand.name].id, { profile: idx < 2 ? 'strong' : idx < 5 ? 'good' : 'fair' }]));
  profiles[apps[nathan.name].id] = { profile: 'weak', notMet: 1 };
  await runCommittee(v, COMMITTEES.atc, { profiles, proposeCount: 7 });
  await approveShortlist(v.id);

  const rounds = await scheduleSession(v.id, ids, {
    startsAt: at(workday(1), '08:30'), mode: 'In-person', location: 'ATC Training Room, Old Control Tower, Entebbe', durationMinutes: 40, gapMinutes: 10,
    instructions: 'Report to the Old Control Tower reception 20 minutes early with your national ID.',
    internalNotes: 'Tower simulator booked for the practical part - confirm with the ATS Training Unit.',
    panelMembers: panel([['Josephine Nabwire', 'Manager Air Traffic Management', true], ['Richard Opio', 'Senior Air Traffic Control Officer'], ['Diana Kyeyune', 'Human Resource Representative']]),
    criteria: [{ name: 'Aviation technical knowledge', weight: 3 }, { name: 'Spatial reasoning (simulator)', weight: 3 }, { name: 'Communication and phraseology', weight: 2 }, { name: 'Decision making under pressure', weight: 2 }]
  });
  await shiftRounds(v.id, Object.values(rounds), 14);
  const R = (cand) => rounds[apps[cand.name].id];
  await hold(R(a), [90, 88, 86], 'Shortlist');
  await hold(R(b), [86, 84, 88], 'Shortlist');
  await hold(R(c), [82, 80, 84], 'Shortlist');
  await hold(R(d), [80, 76, 78], 'Shortlist');
  await hold(R(e), [74, 72, 76], 'Shortlist');
  await hold(R(f), [66, 64, 62], 'Hold', 'Borderline on the simulator; keep in reserve.');
  await hold(R(x), [44, 50, 46], 'Reject', 'Weak spatial reasoning on the simulator exercise.');
  await recordHeldDays(v.id);
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

  await retime(v.id, { created: S + 18, deadline: S + 9, review: S + 8.5, slProposed: S + 3.5, slApproved: S + 3, meritProposed: S - 1.5, meritApproved: S - 2 });
  await retimeCommittee(v.id, { created: S + 8.4, opened: S + 8, moderation: S + 4.5, closed: S + 4 });
  log(`  ${v.jobRef}: committee found Nathan not qualified; Brenda accepted (1/4); Daniel's offer returned, revised and issued; Allan's returned; Esther's awaiting approval; Patience + Ivan in reserve\n`);
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
    essentialRequirements: ['Hands-on administration of production Linux and Windows servers'],
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
  await runCommittee(v, COMMITTEES.it, {
    profiles: { [ids[0]]: { profile: 'strong' }, [ids[1]]: { profile: 'good' }, [ids[2]]: { profile: 'good' }, [ids[3]]: { profile: 'fair' } }, proposeCount: 4
  });
  await approveShortlist(v.id);
  const rounds = await scheduleSession(v.id, ids, {
    startsAt: at(workday(2), '10:00'), mode: 'Virtual', meetingLink: 'https://meet.example.com/ucaa-sysadmin-panel',
    instructions: 'Join from a quiet place with a working camera. The panel will share a short troubleshooting scenario on screen.',
    panelMembers: panel([['Patrick Mugisha', 'Manager Information Technology', true], ['Florence Akello', 'Human Resource Representative'], ['Brian Tumwesigye', 'Senior Systems Administrator']]),
    criteria: [{ name: 'Linux and Windows administration', weight: 3 }, { name: 'Networking and security', weight: 2 }, { name: 'Troubleshooting scenario', weight: 3 }, { name: 'Communication', weight: 1 }]
  });
  await shiftRounds(v.id, Object.values(rounds), 14);
  const R = (cand) => rounds[apps[cand.name].id];
  await hold(R(s1), [86, 82, 84], 'Shortlist');
  await hold(R(s2), [80, 78, 76], 'Shortlist');
  await hold(R(h1), [66, 62, 68], 'Hold');
  await hold(R(r1), [48, 52, 46], 'Reject', 'Limited server administration depth for this level.');
  await recordHeldDays(v.id);
  const S = daysAgoOf(R(s1).scheduledDate) + 14;
  await proposeMerit(v.id, [s1, s2, h1].map((cand) => apps[cand.name].id));
  await retime(v.id, { created: S + 18, deadline: S + 9, review: S + 8.5, slProposed: S + 3.5, slApproved: S + 3, meritProposed: 1 });
  await retimeCommittee(v.id, { created: S + 8.4, opened: S + 8, moderation: S + 4.5, closed: S + 4 });
  log(`  ${v.jobRef}: Arnold (Primary), Sharon + Timothy (Reserve) proposed; Faith rejected by the panel\n`);
  LIVE.push(`${v.jobRef} Systems Administrator - approve the proposed merit list [Principal HR Officer]`);
  return cands;
}

// A time for today's session that is still ahead, or the next working day
// if too little of today is left.
function todaysSessionStart() {
  const local = new Date(NOW + 3 * HOUR);
  const dow = local.getUTCDay();
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = Math.ceil((minutes + 60) / 30) * 30;
  if (dow === 0 || dow === 6 || start + 180 > 18 * 60) return { when: at(workday(1), '09:00'), today: false };
  const hh = String(Math.floor(start / 60)).padStart(2, '0');
  const mm = String(start % 60).padStart(2, '0');
  return { when: at(klaDate(NOW), `${hh}:${mm}`), today: true };
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
    essentialRequirements: ['Security or law-enforcement experience'],
    desirableRequirements: [{ text: 'Do you hold an ICAO AVSEC Basic certificate?', answerType: 'yesno' }, { text: 'Have you operated X-ray screening equipment?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Are you willing to work rotating day and night shifts?', requiredAnswer: 'Yes' }, { text: 'Have you ever been convicted of a criminal offence?', requiredAnswer: 'No' }],
    specialSkills: ['Vigilance and attention to detail']
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
  const who = Object.fromEntries(cands.map((cand) => [cand.name.split(' ')[0], cand]));
  const apps = {};
  for (const [idx, cand] of cands.entries()) {
    apps[cand.name] = await apply(cand, v, { strong: idx % 2 === 0, submit: cand === who.Bosco ? 'refused' : true });
  }
  const A = (first) => apps[who[first].name].id;

  await beginReview(v.id);
  const names = ['Frank', 'Grace', 'Hassan', 'Janet', 'Moses', 'Winnie', 'Ronald', 'Lydia', 'Samuel', 'Christine', 'Paul', 'Agnes'];
  const profiles = Object.fromEntries(names.map((n, idx) => [A(n), { profile: idx < 2 ? 'strong' : idx % 3 === 0 ? 'fair' : 'good' }]));
  profiles[A('Janet')] = { profile: 'fair', dispute: 1 };
  await runCommittee(v, COMMITTEES.avsec, {
    profiles,
    rulings: [{ applicationId: A('Janet'), criterion: 1, outcome: 'Met', reason: 'Two years as a guard commander counts as the minimum experience - the committee accepts it.' }],
    proposeCount: 12
  });
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
  await shiftRounds(v.id, Object.values(held), 7);
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
  await score(H('Winnie'), { 0: 72 }); // two panelists never scored before the day closed
  await api('PATCH', `/api/interviews/${H('Ronald').id}/no-show`, { token: T.shro, json: { notes: 'Did not arrive; phone unreachable on the day.' } });
  await recordHeldDays(v.id);
  const S = daysAgoOf(H('Frank').scheduledDate) + 7;

  // Session B - today (or the next working day if the day is nearly over).
  const { when: sessionB, today } = todaysSessionStart();
  const upcoming = await scheduleSession(v.id, ['Lydia', 'Samuel', 'Christine'].map(A), {
    startsAt: sessionB, ...venue, panelMembers: avsecPanel, criteria: rubric
  });
  await respond(who.Lydia, upcoming[A('Lydia')], 'Confirmed');
  await respond(who.Samuel, upcoming[A('Samuel')], 'RescheduleRequested', 'My final diploma exam was moved to this morning - any time from Thursday would work.');

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

  await retime(v.id, { created: S + 18, deadline: S + 9, review: S + 8.5, slProposed: S + 3.5, slApproved: S + 3 });
  await retimeCommittee(v.id, { created: S + 8.4, opened: S + 8, moderation: S + 4.5, closed: S + 4 });

  const sessionDay = klaDate(sessionB);
  const links = await prisma.panelDayLink.findMany({ where: { vacancyId: v.id, day: sessionDay, revokedAt: null }, orderBy: { id: 'asc' } });
  log(`  ${v.jobRef}: Bosco refused at submission (over the age limit); committee ruled on Janet; last week - Frank + Grace Shortlist, Hassan Hold, Janet Reject, Moses ready to finalize, Winnie missing 2 scores, Ronald no-show`);
  log(`  ${today ? 'today' : sessionDay} - session for Lydia (confirmed), Samuel (asked to reschedule), Christine (no answer); Ronald round 2 and Paul (moved by HR) later; Agnes cancelled, awaiting a new slot\n`);
  LIVE.push(`${v.jobRef} AVSEC Officer - ${today ? 'run TODAY\'s' : `run the ${sessionDay}`} interview session in the Interview Hub (start it, call candidates in); finalize Moses Kyeyune; handle Samuel Okiror's reschedule request; re-book Agnes Nakato [Senior HR Officer]`);
  for (const l of links) LIVE.push(`    panelist day link - ${l.panelistName}: ${frontendUrl}/panel-day/${l.token}`);
}

// Senior ATC Officer (Internal) - verification states, a committee with a
// conflicted member, and the proposed shortlist awaiting approval.
async function scenarioInternalShortlist() {
  log('=== Senior Air Traffic Control Officer (Internal) - shortlist awaiting approval ===');
  const v = await createVacancy({
    positionId: POS.atcSenior.id,
    postingType: 'Internal', positionsRequired: 1, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U3 (UGX 6,200,000 - 7,800,000 per month)', minimumEducationLevel: 'Diploma', minimumExperienceYears: 5,
    jobPurpose: purpose('To supervise a watch of the Entebbe approach and aerodrome control units and act as On-the-Job Training Instructor.', [
      'Supervise watch operations and staffing', 'Conduct on-the-job training and competency checks', 'Investigate and report ATS occurrences', 'Contribute to ATM safety cases'
    ]),
    essentialRequirements: ['Valid ATC licence with Aerodrome and Approach ratings', 'Currently employed by UCAA'],
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
  await runCommittee(v, COMMITTEES.atc, {
    profiles: {
      [apps[david.name].id]: { profile: 'strong' }, [apps[esther.name].id]: { profile: 'good' },
      [apps[quinn.name].id]: { profile: 'fair' }, [apps[rachel.name].id]: { profile: 'weak', notMet: 2 }
    },
    conflicts: [[1, apps[esther.name].id, 'I am her line supervisor.']],
    proposeCount: 2
  });
  await retime(v.id, { created: 22, deadline: 11, review: 10.5, slProposed: 2 });
  await retimeCommittee(v.id, { created: 10.4, opened: 10, moderation: 3, closed: 2.5 });
  log(`  ${v.jobRef}: committee (Josephine stood down for Esther) ranked David, Esther, Quinn; Rachel not qualified; David + Esther proposed; Quinn Pending verification, Rachel Discrepancy_Flagged\n`);
  LIVE.push(`${v.jobRef} Senior ATC Officer (Internal) - approve the committee's proposed shortlist [Principal HR Officer]; verify Quinn Ateenyi [Senior HR Officer]`);
}

// Senior Aviation Security Officer - committee at moderation: the chair has
// a disputed item to settle, and for the applicant the chair stood down from
// an acting chair rules instead.
async function scenarioModeration() {
  log('=== Senior Aviation Security Officer (External) - committee at moderation ===');
  const v = await createVacancy({
    positionId: POS.avsecSenior.id, reportsToPositionId: POS.avsecManager.id,
    postingType: 'External', positionsRequired: 1, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U5 (UGX 2,900,000 - 3,700,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 5,
    jobPurpose: purpose('To supervise an aviation security shift and the screening checkpoints at Entebbe International Airport.', [
      'Supervise screeners and access-control staff on shift', 'Run quality-control tests on screening checkpoints', 'Report and follow up security occurrences', 'Train and certify screeners'
    ]),
    essentialRequirements: ['At least 2 years supervising security staff', 'ICAO AVSEC certification (Basic or higher)'],
    desirableRequirements: [{ text: 'Are you a certified AVSEC instructor?', answerType: 'yesno' }, { text: 'Have you run covert tests of screening checkpoints?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Have you ever been convicted of a criminal offence?', requiredAnswer: 'No' }]
  });
  const cands = await inBatches([
    ['Norah Kyalimpa', 'F', '1988-05-14', 'Uganda Police Force (Aviation Police)', 'Assistant Inspector', 9],
    ['Simon Etyang', 'M', '1986-09-01', 'G4S Secure Solutions', 'Security Manager', 11],
    ['Beatrice Auma', 'F', '1990-02-27', 'Kenya Airports Authority', 'Senior Security Officer', 7],
    ['Charles Mayanja', 'M', '1987-12-09', 'Serena Hotels', 'Chief Security Officer', 8],
    ['Diana Nakanwagi', 'F', '1991-07-19', 'Uganda Revenue Authority', 'Enforcement Officer', 6]
  ].map(([name, sex, dob, employer, title, years]) => ({
    name, sex, dob,
    education: [edu('Makerere University', 'Bachelors', 'Security and Strategic Studies', 2012, 3.4)],
    work: [job(employer, title, years)],
    certs: [cert('ICAO AVSEC Basic', 'East African School of Aviation', 4, 5)]
  })), 3, makeCandidate);
  const apps = {};
  for (const cand of cands) apps[cand.name] = await apply(cand, v, { strong: cand.name !== 'Diana Nakanwagi' });
  const [norah, simon, beatrice, charles, diana] = cands.map((c) => apps[c.name].id);
  await beginReview(v.id);
  const members = [...COMMITTEES.avsec, committeeMember('Gerald Otim', 'Head of Airport Operations')];
  await runCommittee(v, members, {
    ratersPerApplicant: 3,
    profiles: {
      [norah]: { profile: 'strong' }, [simon]: { profile: 'good' }, [beatrice]: { profile: 'good', dispute: 3 },
      [charles]: { profile: 'fair', dispute: 2 }, [diana]: { profile: 'weak', notMet: 2 }
    },
    conflicts: [[0, charles, 'He worked under me at a previous employer.']],
    actingChairs: [{ applicationId: charles, memberIdx: 1 }],
    stopAt: 'Moderation'
  });
  await retime(v.id, { created: 18, deadline: 6, review: 5.5 });
  await retimeCommittee(v.id, { created: 5.4, opened: 5, moderation: 0.5 });
  const ex = await prisma.shortlistExercise.findUnique({ where: { vacancyId: v.id }, include: { members: { orderBy: { id: 'asc' } } } });
  log(`  ${v.jobRef}: rating closed; Beatrice's AVSEC certification disputed (chair to rule); the chair stood down for Charles, so Moses Okiror rules on his disputed item\n`);
  LIVE.push(`${v.jobRef} Senior AVSEC Officer - committee chair rules on Beatrice Auma: ${frontendUrl}/shortlist-panel/${ex.members[0].token}`);
  LIVE.push(`${v.jobRef} Senior AVSEC Officer - acting chair rules on Charles Mayanja: ${frontendUrl}/shortlist-panel/${ex.members[1].token}`);
  LIVE.push(`${v.jobRef} Senior AVSEC Officer - then close the exercise and propose the interview shortlist [Senior HR Officer]`);
}

// IT Support Officer - committee rating in progress.
async function scenarioRating(sysadminCandidates) {
  log('=== IT Support Officer (External) - committee rating in progress ===');
  const v = await createVacancy({
    positionId: POS.itSupport.id, reportsToPositionId: POS.sysadmin.id,
    postingType: 'External', positionsRequired: 2, deadline: dateOnly(20), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U7 (UGX 1,500,000 - 2,100,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 1,
    preferredFieldOfStudy: 'Information Technology', minimumCGPA: 3.0,
    jobPurpose: purpose('To provide first- and second-line ICT support to UCAA staff at Entebbe International Airport and the Head Office.', [
      'Resolve hardware, software and network incidents through the service desk', 'Set up and maintain end-user devices and printers', 'Support airport flight-information display systems', 'Keep the IT asset register up to date'
    ]),
    essentialRequirements: ['Service-desk or IT support experience'],
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
  const al = await apply(linda, v);
  const an = await apply(nicholas, v);
  const ao = await apply(olivia, v, { strong: false });
  // Both turned away at submission: below the minimum qualification, and a
  // "No" to shift work. Their drafts stay on their dashboards.
  await apply(patrick, v, { strong: false, submit: 'refused' });
  await apply(sandra, v, { disq: { 0: false }, submit: 'refused' });
  // Two of the Systems Administrator candidates applied here as well.
  const at1 = await apply(sysadminCandidates[2], v);
  const af = await apply(sysadminCandidates[3], v, { strong: false });
  await beginReview(v.id);
  await runCommittee(v, COMMITTEES.it, {
    profiles: {
      [al.id]: { profile: 'strong' }, [an.id]: { profile: 'good' }, [ao.id]: { profile: 'fair' },
      [at1.id]: { profile: 'good' }, [af.id]: { profile: 'fair' }
    },
    conflicts: [[1, al.id, 'We worked together at MTN Uganda until last year.']],
    partial: { 2: 2 },
    stopAt: 'Rating'
  });
  await retime(v.id, { created: 20, deadline: 5, review: 4.5 });
  await retimeCommittee(v.id, { created: 4.4, opened: 4 });
  const ex = await prisma.shortlistExercise.findUnique({ where: { vacancyId: v.id }, include: { members: { orderBy: { id: 'asc' } } } });
  log(`  ${v.jobRef}: 5 applicants being rated (Patrick and Sandra were refused at submission); Patrick Mugisha and Brian Tumwesigye submitted (Brian stood down for Linda); Irene Kobusingye has rated 2 of 5\n`);
  LIVE.push(`${v.jobRef} IT Support Officer - Irene Kobusingye finishes rating and submits: ${frontendUrl}/shortlist-panel/${ex.members[2].token}`);
  LIVE.push(`${v.jobRef} IT Support Officer - then close rating (moderation), close the exercise and propose the shortlist [Senior HR Officer]`);
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
    essentialRequirements: ['Training in aeronautical information services'],
    desirableRequirements: [{ text: 'Are you trained on an AIXM-based AIM system?', answerType: 'yesno' }],
    disqualifyingRequirements: []
  };
  const v = await createVacancy({ positionId: POS.ais.id, ...body, deadline: dateOnly(20) });
  const [tom, ruth] = await inBatches([
    { name: 'Tom Odongo', sex: 'M', dob: '1994-03-08', education: [edu('East African School of Aviation', 'Diploma', 'Aeronautical Information Services', 2018)], work: [job('Aviation Handling Services', 'Flight Operations Assistant', 3)] },
    { name: 'Ruth Kemigisha', sex: 'F', dob: '1993-11-19', education: [edu('East African School of Aviation', 'Diploma', 'Aeronautical Information Management', 2016)], work: [job('Kenya Airports Authority', 'AIS Officer', 5)] }
  ], 2, makeCandidate);
  const tomApp = await apply(tom, v, { strong: false });
  const ruthApp = await apply(ruth, v);
  await api('PATCH', `/api/applications/${ruthApp.id}/withdraw`, { token: ruth.token, json: { reason: 'I have accepted a promotion with my current employer.' } });
  await beginReview(v.id);
  await reject(tomApp.id, 'The AIS training claimed on the application could not be confirmed with the training school.');
  await api('PATCH', `/api/vacancies/${v.id}/close`, { token: T.phro, json: { reason: 'Too few qualified applicants - to be readvertised with a lower experience requirement.' } });
  await retime(v.id, { created: 26, deadline: 12, review: 11, rejected: 10.5 });

  const re = await api('POST', `/api/vacancies/${v.id}/readvertise`, { token: T.hro, json: { ...body, deadline: dateOnly(21), minimumExperienceYears: 1 } });
  await api('PATCH', `/api/vacancies/${re.id}/approve`, { token: T.manager });
  await retime(re.id, { created: 2 });
  log(`  ${v.jobRef} closed (one withdrawal, one rejection) -> readvertised as ${re.jobRef} asking 1 year's experience, now Open\n`);
}

// Fire Fighter - open, receiving applications; the committee is being set up.
async function scenarioOpen() {
  log('=== Fire Fighter (External) - open, committee being set up ===');
  const v = await createVacancy({
    positionId: POS.fireFighter.id, reportsToPositionId: POS.fireOfficer.id,
    postingType: 'External', positionsRequired: 4, deadline: dateOnly(18), employmentCategory: 'FullTime', location: 'Entebbe International Airport',
    salaryScale: 'U8 (UGX 1,100,000 - 1,500,000 per month)', minimumEducationLevel: 'Certificate', minimumAge: 18, maximumAge: 28,
    jobPurpose: purpose('To provide aerodrome rescue and fire-fighting cover so that aircraft operations at Entebbe meet ICAO Category 9 requirements.', [
      'Respond to aircraft and domestic fire emergencies', 'Operate and maintain fire tenders and rescue equipment', 'Take part in daily drills and physical training', 'Carry out fire-safety inspections of airport premises'
    ]),
    essentialRequirements: ['Uganda Advanced Certificate of Education (UACE)', 'Physically fit and able to pass a medical examination'],
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
  await beginReview(v.id);
  await runCommittee(v, COMMITTEES.fire, { stopAt: 'Setup' });
  await retime(v.id, { created: 6, review: 0.5 });
  await retimeCommittee(v.id, { created: 0.4 });
  log(`  ${v.jobRef}: 4 submitted, Robert still in draft, Stella withdrew; committee of 3 invited, rating opens after the deadline\n`);
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
    essentialRequirements: ['Experience in commercial air operations on multi-engine aircraft'],
    desirableRequirements: [{ text: 'Do you hold a type rating on a transport-category jet?', answerType: 'yesno' }],
    disqualifyingRequirements: [{ text: 'Do you hold, or have you held, an ATPL?', requiredAnswer: 'Yes' }]
  }, 'dhra');
  await api('PATCH', `/api/vacancies/${v.id}/transition-posting-type`, { token: T.manager, json: { postingType: 'External', deadline: dateOnly(24) } });
  const [pilot1, pilot2] = await inBatches([
    { name: 'Capt. Andrew Mukasa', sex: 'M', dob: '1978-05-04', flyingHours: 8200, education: [edu('Makerere University', 'Bachelors', 'Mechanical Engineering', 2000, 3.3)], work: [job('RwandAir', 'First Officer, B737', 14, 6), job('Uganda Airlines', 'Captain, CRJ-900', 6)], certs: [cert('Airline Transport Pilot Licence (ATPL)', 'Uganda Civil Aviation Authority', 12)] },
    { name: 'Capt. Miriam Nalubega', sex: 'F', dob: '1986-12-22', flyingHours: 2400, education: [edu('Soroti Flying School', 'Diploma', 'Commercial Pilot Training', 2009)], work: [job('Eagle Air', 'First Officer', 9)], certs: [cert('CPL with instrument rating', 'Uganda Civil Aviation Authority', 10)] }
  ], 2, makeCandidate);
  await apply(pilot1, v);
  await apply(pilot2, v, { strong: false, submit: 'refused' });
  await retime(v.id, { created: 9, changed: 4 });
  log(`  ${v.jobRef}: no internal applicants -> switched to External by the Manager; Andrew applied; Miriam refused at submission (2,400 of 3,000 flying hours)\n`);
}

async function scenarioPendingApproval() {
  log('=== Vacancies awaiting approval ===');
  const acc = await createVacancy({
    positionId: POS.accountant.id, reportsToPositionId: POS.seniorAccountant.id,
    postingType: 'External', positionsRequired: 2, deadline: dateOnly(28), employmentCategory: 'FullTime', location: 'UCAA Head Office — Entebbe',
    salaryScale: 'U6 (UGX 2,000,000 - 2,600,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 2,
    jobPurpose: purpose('To process payments, receipts and reconciliations for the Finance department.', ['Process supplier payments', 'Reconcile aeronautical revenue', 'Prepare VAT and PAYE returns']),
    essentialRequirements: ['CPA or ACCA (at least part-qualified)'],
    desirableRequirements: [{ text: 'Are you a full member of ICPAU?', answerType: 'yesno' }],
    disqualifyingRequirements: []
  }, null);
  await prisma.vacancy.update({ where: { id: acc.id }, data: { createdAt: ago(3) } });
  const hr = await createVacancy({
    positionId: POS.hrOfficer.id,
    postingType: 'Internal', positionsRequired: 1, deadline: dateOnly(21), employmentCategory: 'FullTime', location: 'UCAA Head Office — Entebbe',
    salaryScale: 'U6 (UGX 2,000,000 - 2,600,000 per month)', minimumEducationLevel: 'Bachelors', minimumExperienceYears: 2,
    jobPurpose: purpose('To support recruitment, onboarding and staff records for the Directorate of Human Resource and Administration.', ['Coordinate recruitment logistics', 'Maintain personnel files', 'Support the performance-management cycle']),
    essentialRequirements: ['Currently employed by UCAA'],
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
      data: { createdAt: created, profileCompletedAt: c.profileCompletedAt ? new Date(created.getTime() + 2 * HOUR) : null }
    });
  }

  log('=== Maintenance jobs (SLA escalations, deadline notices, interview reminders, sessions, offer expiry) ===');
  // Every job the health banner watches, so a fresh demo DB shows none as never run.
  for (const { name } of require('../src/services/systemHealthService').JOBS) {
    const mod = require(`./${name}`);
    await runJob(name, () => mod.run());
  }

  // Staff inboxes: routine notices read, anything that asks for action unread.
  const ACTIONABLE = ['VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'MeritListProposed', 'OfferReturned',
    'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewSessionNotStarted',
    'OfferDeclined', 'OfferExpired', 'VacancyDeadlinePassed'];
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
    await scenarioModeration();
    await scenarioRating(sysadminCandidates);
    await scenarioClosedReadvertised();
    await scenarioOpen();
    await scenarioTransitioned();
    await scenarioPendingApproval();
    await finish();

    log('\n=== Done ===');
    log(`${await prisma.vacancy.count()} vacancies, ${await prisma.candidate.count()} candidates, ${await prisma.application.count()} applications `
      + `(${await prisma.applicationDocument.count()} documents), ${await prisma.shortlistExercise.count()} committees, `
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

if (require.main === module) {
  main().catch((e) => {
    console.error('\nSEED FAILED:', e);
    process.exitCode = 1;
  });
}
