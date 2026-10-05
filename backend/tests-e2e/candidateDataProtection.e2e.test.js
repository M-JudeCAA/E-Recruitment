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

describe('data retention and erasure (FR-ATS-079/080)', () => {
  const fs = require('fs');
  const path = require('path');
  const uploads = () => path.resolve(process.env.UPLOAD_DIR || './uploads');

  test('a candidate downloads their data and asks for erasure; a Manager completes it once nothing is in progress', async () => {
    const vacancy = await createVacancy();
    expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);
    const ivy = await createCandidate({ fullName: 'Ivy Isingoma', email: 'ivy@example.com' });
    const { applicationId, document } = await applyAs(ivy, vacancy.id);
    const token = await candidateToken(ivy.email);

    const copy = expectStatus(await api(token).get('/api/candidates/me/data-export'), 200);
    expect(copy.headers['content-disposition']).toContain('attachment');
    expect(copy.body).toEqual(expect.objectContaining({ fullName: 'Ivy Isingoma', email: 'ivy@example.com' }));
    expect(copy.body.passwordHash).toBeUndefined();
    expect(copy.body.applications[0].vacancy.jobRef).toBe(vacancy.jobRef);

    const asked = expectStatus(await api(token).post('/api/candidates/me/data-requests', { reason: 'I no longer want to be considered.' }), 201).body;
    expect((await api(token).post('/api/candidates/me/data-requests', {})).status).toBe(409);
    expect(await prisma.notification.count({ where: { recipientId: staff.manager.id, taskType: 'DataErasureRequested' } })).toBeGreaterThan(0);

    // Not while the application is in progress.
    expect((await api(tokens.hro).get('/api/data-protection/requests')).status).toBe(403);
    const pending = expectStatus(await api(tokens.manager).get('/api/data-protection/requests?status=Pending'), 200).body;
    expect(pending[0].blocker).toMatch(/in progress/);
    expect((await api(tokens.manager).patch(`/api/data-protection/requests/${asked.id}/complete`)).status).toBe(409);

    // Once it's over, the data goes.
    await prisma.application.update({ where: { id: applicationId }, data: { status: 'Rejected', rejectedAt: new Date() } });
    const file = path.join(uploads(), path.basename(document.fileUrl));
    expect(fs.existsSync(file)).toBe(true);
    const done = expectStatus(await api(tokens.manager).patch(`/api/data-protection/requests/${asked.id}/complete`), 200).body;
    expect(done.removed).toEqual(expect.objectContaining({ documents: 1, files: 1, applications: 1 }));

    const erased = await prisma.candidate.findUnique({ where: { id: ivy.id }, include: { education: true, workExperience: true } });
    expect(erased).toEqual(expect.objectContaining({
      fullName: `Removed candidate ${ivy.id}`, email: `removed-${ivy.id}@removed.invalid`, nationalId: null, passwordHash: null, location: null
    }));
    expect(erased.purgedAt).not.toBeNull();
    expect(erased.education).toEqual([]);
    expect(erased.workExperience).toEqual([]);
    const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { documents: true } });
    expect(application).toEqual(expect.objectContaining({ status: 'Rejected', referees: null, whyThisRole: null }));
    expect(application.documents).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
    expect((await request(app).post('/api/candidates/auth/login').send({ email: 'ivy@example.com', password: 'ChangeMe123!' })).status).toBe(401);
    const log = expectStatus(await api(tokens.manager).get('/api/data-protection/purges'), 200).body;
    expect(log[0]).toEqual(expect.objectContaining({ candidateId: ivy.id, reason: 'ErasureRequest', requestId: asked.id, performedById: staff.manager.id }));
  });

  test('a refused request tells the candidate why', async () => {
    const joe = await createCandidate({ fullName: 'Joe Juuko', email: 'joe@example.com' });
    const token = await candidateToken(joe.email);
    const asked = expectStatus(await api(token).post('/api/candidates/me/data-requests', {}), 201).body;
    expect((await api(tokens.manager).patch(`/api/data-protection/requests/${asked.id}/refuse`, { reason: 'x' })).status).toBe(400);
    expectStatus(await api(tokens.manager).patch(`/api/data-protection/requests/${asked.id}/refuse`, { reason: 'Your appeal on the last recruitment is still open.' }), 200);
    expect(await prisma.candidateNotification.count({ where: { candidateId: joe.id, type: 'DataRequestRefused' } })).toBeGreaterThan(0);
    expect(expectStatus(await api(token).get('/api/candidates/me/data-requests'), 200).body[0]).toEqual(expect.objectContaining({ status: 'Refused' }));
  });

  test('the retention purge erases candidates inactive past the setting, and nobody else', async () => {
    const old = new Date(Date.now() - 30 * 30 * 86400000); // ~30 months ago
    const gone = await createCandidate({ fullName: 'Old Applicant', email: 'old@example.com' });
    const recent = await createCandidate({ fullName: 'Recent Applicant', email: 'recent@example.com' });
    await prisma.candidate.update({ where: { id: gone.id }, data: { createdAt: old, lastLoginAt: old } });

    // Settings: a Manager or a system administrator, never an HR Officer.
    expect((await api(tokens.hro).put('/api/settings/candidateRetentionMonths', { value: 12 })).status).toBe(403);
    expect((await api(tokens.manager).put('/api/settings/candidateRetentionMonths', { value: 3 })).status).toBe(400);
    const list = expectStatus(await api(tokens.manager).put('/api/settings/candidateRetentionMonths', { value: 36 }), 200).body;
    expect(list.find((s) => s.key === 'candidateRetentionMonths').value).toBe(36);
    const admin = await prisma.staffUser.create({ data: { name: 'Sys Admin', email: 'admin@caa.co.ug', role: null, isSystemAdmin: true, department: 'ICT', passwordHash: (await prisma.staffUser.findUnique({ where: { id: staff.hro.id } })).passwordHash } });
    expectStatus(await api(await staffToken(admin.email)).get('/api/settings'), 200);

    const job = require('../scripts/purgeCandidateData');
    expect(await job.run()).toMatch(/0 candidate/); // 30 months < 36
    expectStatus(await api(tokens.manager).put('/api/settings/candidateRetentionMonths', { value: 24 }), 200);
    expect(await job.run()).toMatch(/1 candidate/);
    expect((await prisma.candidate.findUnique({ where: { id: gone.id } })).purgedAt).not.toBeNull();
    expect((await prisma.candidate.findUnique({ where: { id: recent.id } })).purgedAt).toBeNull();
    expect((await prisma.dataPurgeLog.findFirst({ where: { candidateId: gone.id } })).reason).toBe('Retention');
  });
});
