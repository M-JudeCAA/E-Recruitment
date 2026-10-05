const {
  prisma, resetDatabase, createStaff, createOrg, createCandidate, staffToken, api, expectStatus
} = require('./helpers');

// Candidate tags and keyword search (FR-ATS-051/052) and bulk email from a
// template (FR-ATS-050), against the real schema.

let staff;
let tokens;
let vacancy;
let apps;

beforeEach(async () => {
  await resetDatabase();
  staff = { hro: await createStaff('HR_Officer', 'hro@caa.co.ug'), shro: await createStaff('Senior_HR_Officer', 'shro@caa.co.ug') };
  tokens = { hro: await staffToken('hro@caa.co.ug'), shro: await staffToken('shro@caa.co.ug') };
  const org = await createOrg(staff.hro.id);
  vacancy = await prisma.vacancy.create({
    data: {
      jobRef: 'UCAA/ADV/EXT/001/2026', title: 'Air Traffic Controller', positionId: org.position.id, departmentId: org.department.id,
      postingType: 'External', status: 'Open', positionsRequired: 1, createdById: staff.hro.id
    }
  });
  apps = [];
  for (const [i, name] of ['Grace Atim', 'Peter Okello', 'Never Applied'].entries()) {
    const c = await createCandidate({ fullName: name, email: `p${i}@example.com` });
    if (i < 2) {
      apps.push(await prisma.application.create({ data: { candidateId: c.id, vacancyId: vacancy.id, status: 'UnderReview', submittedDate: new Date() } }));
    }
  }
  await prisma.workExperience.create({ data: { candidateId: apps[0].candidateId, employer: 'Kenya Airports Authority', jobTitle: 'ATC Assistant', startDate: new Date('2018-01-01') } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('HR tags candidates and finds past applicants by keyword and tag', async () => {
  const tagged = expectStatus(await api(tokens.hro).post(`/api/talent/candidates/${apps[0].candidateId}/tags`, { name: 'ATM trainees' }), 200).body;
  expect(tagged.map((t) => t.name)).toEqual(['ATM trainees']);
  const [tag] = expectStatus(await api(tokens.hro).get('/api/talent/tags'), 200).body;
  expect(tag).toEqual(expect.objectContaining({ name: 'ATM trainees', candidates: 1 }));

  // Keyword in the work history; someone who never applied isn't searchable.
  let found = expectStatus(await api(tokens.hro).get('/api/talent/candidates?q=airports'), 200).body;
  expect(found.data.map((c) => c.fullName)).toEqual(['Grace Atim']);
  expect(found.data[0].tags[0].name).toBe('ATM trainees');
  expect(found.data[0].applications[0].vacancy.jobRef).toBe('UCAA/ADV/EXT/001/2026');
  found = expectStatus(await api(tokens.hro).get('/api/talent/candidates?q=never'), 200).body;
  expect(found.total).toBe(0);
  found = expectStatus(await api(tokens.hro).get(`/api/talent/candidates?tags=${tag.id}`), 200).body;
  expect(found.total).toBe(1);
  expect(await prisma.dataAccessLog.count({ where: { action: 'Searched candidates' } })).toBeGreaterThan(0);

  // Tags show on the vacancy's applicant list.
  const list = expectStatus(await api(tokens.hro).get(`/api/vacancies/${vacancy.id}/applications`), 200).body;
  expect(list.find((a) => a.id === apps[0].id).candidate.tags[0].tag.name).toBe('ATM trainees');

  expectStatus(await api(tokens.hro).delete(`/api/talent/candidates/${apps[0].candidateId}/tags/${tag.id}`), 200);
  expectStatus(await api(tokens.hro).delete(`/api/talent/tags/${tag.id}`), 403);
});

test('a bulk email from a template goes to each candidate filled with their details, and is kept', async () => {
  const templates = expectStatus(await api(tokens.shro).get('/api/bulk-email/templates'), 200).body;
  const regret = templates.find((t) => t.key === 'emailRegret');
  expect(regret.subject).toContain('{{jobTitle}}');

  const body = { templateKey: 'emailRegret', subject: regret.subject, body: regret.body, applicationIds: apps.map((a) => a.id) };
  expectStatus(await api(tokens.hro).post('/api/bulk-email/send', body), 403);
  const preview = expectStatus(await api(tokens.shro).post('/api/bulk-email/preview', body), 200).body;
  expect(preview.count).toBe(2);
  expect(preview.subject).toBe('Your application for Air Traffic Controller (UCAA/ADV/EXT/001/2026)');
  expect(preview.html).toContain('Dear Grace Atim');

  const sent = expectStatus(await api(tokens.shro).post('/api/bulk-email/send', body), 201).body;
  expect(sent).toEqual(expect.objectContaining({ sent: 2, failed: 0 }));
  const kept = await prisma.bulkEmail.findUnique({ where: { id: sent.id }, include: { recipients: true } });
  expect(kept).toEqual(expect.objectContaining({ vacancyId: vacancy.id, recipientCount: 2, templateKey: 'emailRegret' }));
  expect(kept.recipients.map((r) => r.email).sort()).toEqual(['p0@example.com', 'p1@example.com']);
  expect(await prisma.auditLog.count({ where: { entityType: 'Vacancy', entityId: vacancy.id, action: 'Bulk email sent' } })).toBe(1);
  expect(expectStatus(await api(tokens.hro).get(`/api/bulk-email?vacancyId=${vacancy.id}`), 200).body).toHaveLength(1);

  // Nobody chosen, or no subject, is refused.
  expectStatus(await api(tokens.shro).post('/api/bulk-email/send', { ...body, applicationIds: [] }), 400);
  expectStatus(await api(tokens.shro).post('/api/bulk-email/send', { ...body, subject: ' ' }), 400);
});
