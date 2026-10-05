const request = require('supertest');
const {
  prisma, app, resetDatabase, createStaff, createOrg, createCandidate, staffToken, candidateToken, api, REFEREES,
  expectStatus, attachAcademicDocument, createVacancyFromRequisition
} = require('./helpers');
const accessLog = require('../src/services/accessLogService');

// Duplicate applicants (FR-ATS-037) and the record of who viewed candidate
// data (FR-ATS-081).

let staff;
let tokens;
let org;

beforeEach(async () => {
  await resetDatabase();
  accessLog.resetThrottle();
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    manager: await createStaff('Manager', 'manager@caa.co.ug')
  };
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
  org = await createOrg(staff.hro.id);
});

async function createVacancy() {
  return expectStatus(await createVacancyFromRequisition(tokens.hro, {
    positionId: org.position.id, postingType: 'External', positionsRequired: 1,
    deadline: new Date(Date.now() + 14 * 86400000).toISOString()
  }), 201).body;
}

async function applyAs(candidate, vacancyId) {
  const token = await candidateToken(candidate.email);
  const draft = expectStatus(await api(token).post('/api/applications', { vacancyId, referees: REFEREES }), 201).body;
  const document = await attachAcademicDocument(token, draft.id);
  expectStatus(await api(token).patch(`/api/applications/${draft.id}/submit`, { consent: true }), 200);
  return { applicationId: draft.id, document };
}

test('registering with a phone number another account uses asks first, and goes ahead once the person says it is not them', async () => {
  const existing = await createCandidate({ fullName: 'Grace Namuli', email: 'grace@example.com' });
  await prisma.candidate.update({ where: { id: existing.id }, data: { phone: '+256 772 123456', phoneKey: '772123456' } });

  const body = { fullName: 'Grace N', email: 'grace.n@example.com', password: 'Str0ng!Pass', phone: '0772-123-456', nationalId: 'CM90ZZ12345678' };
  const asked = await request(app).post('/api/candidates/auth/register').send(body);
  expect(asked.status).toBe(409);
  expect(asked.body.code).toBe('POSSIBLE_DUPLICATE_ACCOUNT');
  // The other account is never named.
  expect(JSON.stringify(asked.body)).not.toContain('grace@example.com');
  expect(await prisma.pendingCandidateRegistration.count()).toBe(0);

  const res = await request(app).post('/api/candidates/auth/register').send({ ...body, confirmNotDuplicate: true });
  expect(res.status).toBeLessThan(300);
  expect(await prisma.pendingCandidateRegistration.count()).toBe(1);
});

test('HR sees applicants on the same vacancy who share a phone number flagged as possible duplicates', async () => {
  const vacancy = await createVacancy();
  const a = await createCandidate({ fullName: 'John Okello', email: 'john@example.com' });
  const b = await createCandidate({ fullName: 'J. Okello', email: 'jokello@example.com' });
  const c = await createCandidate({ fullName: 'Mary Akello', email: 'mary@example.com' });
  await prisma.candidate.update({ where: { id: a.id }, data: { phone: '0701555111', phoneKey: '701555111' } });
  await prisma.candidate.update({ where: { id: b.id }, data: { phone: '+256701555111', phoneKey: '701555111' } });
  await prisma.candidate.update({ where: { id: c.id }, data: { phone: '0701999000', phoneKey: '701999000' } });
  const appA = await applyAs(a, vacancy.id);
  const appB = await applyAs(b, vacancy.id);
  const appC = await applyAs(c, vacancy.id);

  const list = expectStatus(await api(tokens.hro).get(`/api/vacancies/${vacancy.id}/applications`), 200).body;
  const rows = Array.isArray(list) ? list : list.applications;
  const byId = new Map(rows.map((r) => [r.id, r]));
  expect(byId.get(appA.applicationId).possibleDuplicates).toEqual([
    expect.objectContaining({ applicationId: appB.applicationId, candidateName: 'J. Okello' })
  ]);
  expect(byId.get(appB.applicationId).possibleDuplicates).toEqual([expect.objectContaining({ applicationId: appA.applicationId })]);
  expect(byId.get(appC.applicationId).possibleDuplicates || []).toEqual([]);
});

test('records who viewed an applicant - the applicant list and their documents - and shows it to Managers only', async () => {
  const vacancy = await createVacancy();
  const candidate = await createCandidate({ fullName: 'Ruth Atim', email: 'ruth@example.com' });
  const other = await createCandidate({ fullName: 'Peter Mugisha', email: 'peter@example.com' });
  const { applicationId, document } = await applyAs(candidate, vacancy.id);
  await applyAs(other, vacancy.id);

  expectStatus(await api(tokens.hro).get(`/api/vacancies/${vacancy.id}/applications`), 200);
  expectStatus(await api(tokens.hro).get(`/api/vacancies/${vacancy.id}/applications`), 200); // throttled: recorded once
  expectStatus(await api(tokens.hro).get(document.fileUrl), 200);

  // HR Officers can't see the record.
  expect((await api(tokens.hro).get(`/api/audit/access/applications/${applicationId}`)).status).toBe(403);

  const views = expectStatus(await api(tokens.manager).get(`/api/audit/access/applications/${applicationId}`), 200).body;
  expect(views.map((v) => [v.who, v.action, v.document])).toEqual([
    [staff.hro.name, 'Opened a document', expect.any(String)],
    [staff.hro.name, 'Viewed the applicants', null]
  ]);
  expect(views[0].document).toBe(document.fileUrl.split('/').pop());

  // A list view is recorded against every applicant on it (array_contains on the JSON column).
  const otherApp = await prisma.application.findFirst({ where: { candidateId: other.id } });
  const otherViews = expectStatus(await api(tokens.manager).get(`/api/audit/access/applications/${otherApp.id}`), 200).body;
  expect(otherViews.map((v) => v.action)).toEqual(['Viewed the applicants']);
});

test('the retention job removes access records past the retention period and keeps the rest', async () => {
  const day = 24 * 60 * 60 * 1000;
  await prisma.dataAccessLog.createMany({ data: [
    { actorType: 'staff', staffUserId: staff.hro.id, action: 'Viewed the applicants', candidateIds: [1], at: new Date(Date.now() - 731 * day) },
    { actorType: 'staff', staffUserId: staff.hro.id, action: 'Opened a document', candidateIds: [1], at: new Date(Date.now() - 729 * day) },
    { actorType: 'staff', staffUserId: staff.hro.id, action: 'Viewed the applicants', candidateIds: [1] }
  ] });

  const summary = await require('../scripts/purgeAccessLog').run();

  expect(summary).toMatch(/1 record\(s\) older than 730 days removed/);
  expect((await prisma.dataAccessLog.findMany({ orderBy: { at: 'asc' } })).map((r) => r.action))
    .toEqual(['Opened a document', 'Viewed the applicants']);
});
