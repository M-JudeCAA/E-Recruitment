const {
  prisma, resetDatabase, createStaff, createOrg, createCandidate,
  staffToken, candidateToken, api, REFEREES, expectStatus
} = require('./helpers');

// The whole recruitment lifecycle through the real API and a real database:
// vacancy creation and approval, applications, screening, the shortlist
// propose/approve split, interviews, and the offer recommend/approve/
// accept/decline steps - including the rules added on 24 September 2026
// (vacancy visibility, offer self-approval, decline notices).

let staff;
let tokens;
let org;

beforeEach(async () => {
  await resetDatabase();
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    shro: await createStaff('Senior_HR_Officer', 'shro@caa.co.ug'),
    phro: await createStaff('Principal_HR_Officer', 'phro@caa.co.ug'),
    phro2: await createStaff('Principal_HR_Officer', 'phro2@caa.co.ug'),
    manager: await createStaff('Manager', 'manager@caa.co.ug'),
    manager2: await createStaff('Manager', 'manager2@caa.co.ug')
  };
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
  org = await createOrg(staff.hro.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const inDays = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();

async function createApprovedVacancy({ positionsRequired = 1 } = {}) {
  const created = expectStatus(await api(tokens.hro).post('/api/vacancies', {
    positionId: org.position.id, postingType: 'External', deadline: inDays(30), positionsRequired,
    internalSalaryRange: 'UGX 10-12M', recruiterNotes: 'HR only'
  }), 201).body;
  return created;
}

async function applyAs(candidate, vacancyId) {
  const token = await candidateToken(candidate.email);
  const draft = expectStatus(await api(token).post('/api/applications', { vacancyId, referees: REFEREES }), 201).body;
  expectStatus(await api(token).patch(`/api/applications/${draft.id}/submit`), 200);
  return { token, applicationId: draft.id };
}

// Carries the given applications (in rank order) through review, shortlist
// approval and a "Shortlist" interview recommendation.
async function shortlistAndInterview(vacancyId, applicationIds, interviewIds = applicationIds) {
  expectStatus(await api(tokens.shro).patch(`/api/vacancies/${vacancyId}/begin-review`), 200);
  const versions = Object.fromEntries((await prisma.application.findMany({ where: { id: { in: applicationIds } } }))
    .map((a) => [a.id, a.rankVersion]));
  expectStatus(await api(tokens.shro).post(`/api/vacancies/${vacancyId}/rank`, { applicationIds, applicationRankVersions: versions }), 200);
  expectStatus(await api(tokens.phro).post(`/api/applications/vacancies/${vacancyId}/approve-shortlist`), 200);

  for (const applicationId of interviewIds) {
    const round = expectStatus(await api(tokens.shro).post(`/api/interviews/applications/${applicationId}/interviews`, {
      scheduledDate: inDays(3), mode: 'In person', panelMembers: [{ name: 'Panelist One', trade: 'HR', email: 'panel@caa.co.ug' }]
    }), 201).body;
    const [panelMember] = await prisma.panelMember.findMany({ where: { interviewRoundId: round.id } });
    expectStatus(await api(tokens.shro).patch(`/api/interviews/panel-members/${panelMember.id}/score`, { score: 82 }), 200);
    expectStatus(await api(tokens.shro).patch(`/api/interviews/${round.id}/finalize`, { recommendation: 'Shortlist' }), 200);
  }
}

test('carries a vacancy from creation to an accepted hire', async () => {
  const vacancy = await createApprovedVacancy();
  expect(vacancy.status).toBe('PendingApproval');

  // Awaiting approval: invisible to the public, by id as well as in the listing.
  expect((await api().get(`/api/vacancies/${vacancy.id}`)).status).toBe(404);

  // Approval is Manager tier - the HR Officer who created it can't; a Manager can.
  expect((await api(tokens.hro).patch(`/api/vacancies/${vacancy.id}/approve`)).status).toBe(403);
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);

  const publicView = expectStatus(await api().get(`/api/vacancies/${vacancy.id}`), 200).body;
  expect(publicView.status).toBe('Open');
  expect(publicView.internalSalaryRange).toBeUndefined();
  expect(publicView.recruiterNotes).toBeUndefined();
  expect(publicView.approvedByRole).toBeUndefined();

  const alice = await createCandidate({ fullName: 'Alice Nakato', email: 'alice@example.com' });
  const bob = await createCandidate({ fullName: 'Bob Okello', email: 'bob@example.com' });
  const a = await applyAs(alice, vacancy.id);
  const b = await applyAs(bob, vacancy.id);

  await shortlistAndInterview(vacancy.id, [a.applicationId, b.applicationId], [a.applicationId]);
  const ranked = await prisma.application.findMany({ where: { vacancyId: vacancy.id }, orderBy: { rank: 'asc' } });
  expect(ranked.map((r) => [r.id, r.listStatus])).toEqual([[a.applicationId, 'Primary'], [b.applicationId, 'Reserve']]);

  expectStatus(await api(tokens.phro).post(`/api/applications/${a.applicationId}/recommend-offer`), 201);
  const offer = await prisma.offer.findUnique({ where: { applicationId: a.applicationId } });
  expectStatus(await api(tokens.manager).patch(`/api/applications/offers/${offer.id}/approve`), 200);

  // The candidate's view of their applications carries no HR-only fields.
  const mine = expectStatus(await api(a.token).get('/api/candidates/me/applications'), 200).body;
  expect(mine[0].vacancy.internalSalaryRange).toBeUndefined();

  expectStatus(await api(a.token).patch(`/api/applications/offers/${offer.id}/accept`), 200);

  const filled = await prisma.vacancy.findUnique({ where: { id: vacancy.id } });
  expect(filled.status).toBe('Filled');
  expect(filled.filledAt).not.toBeNull();
  expect(await prisma.auditLog.count({ where: { entityType: 'HireSnapshot', entityId: offer.id } })).toBe(1);
  // The candidate was told about the offer once it was approved.
  expect(await prisma.candidateNotification.count({ where: { candidateId: alice.id, type: 'OfferReceived', channel: 'InApp' } })).toBe(1);
});

test('blocks a Manager from approving an offer they recommended themselves', async () => {
  const vacancy = await createApprovedVacancy();
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);
  const alice = await createCandidate({ fullName: 'Alice Nakato', email: 'alice@example.com' });
  const a = await applyAs(alice, vacancy.id);
  await shortlistAndInterview(vacancy.id, [a.applicationId]);

  // A Manager meets both the recommend tier and the approve tier.
  expectStatus(await api(tokens.manager).post(`/api/applications/${a.applicationId}/recommend-offer`), 201);
  const offer = await prisma.offer.findUnique({ where: { applicationId: a.applicationId } });

  const selfApproval = await api(tokens.manager).patch(`/api/applications/offers/${offer.id}/approve`);
  expect(selfApproval.status).toBe(422);
  expect(selfApproval.body.error).toMatch(/Self-approval blocked/);
  expect((await prisma.offer.findUnique({ where: { id: offer.id } })).status).toBe('Recommended');

  expectStatus(await api(tokens.manager2).patch(`/api/applications/offers/${offer.id}/approve`), 200);
});

test('declining an offer promotes the reserve and tells every Principal HR Officer', async () => {
  const vacancy = await createApprovedVacancy();
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);
  const alice = await createCandidate({ fullName: 'Alice Nakato', email: 'alice@example.com' });
  const bob = await createCandidate({ fullName: 'Bob Okello', email: 'bob@example.com' });
  const a = await applyAs(alice, vacancy.id);
  const b = await applyAs(bob, vacancy.id);
  await shortlistAndInterview(vacancy.id, [a.applicationId, b.applicationId], [a.applicationId]);
  expectStatus(await api(tokens.phro).post(`/api/applications/${a.applicationId}/recommend-offer`), 201);
  const offer = await prisma.offer.findUnique({ where: { applicationId: a.applicationId } });
  expectStatus(await api(tokens.manager).patch(`/api/applications/offers/${offer.id}/approve`), 200);

  const res = expectStatus(await api(a.token).patch(`/api/applications/offers/${offer.id}/decline`), 200);
  // The reply never carries the promoted reserve's application.
  expect(res.body).toEqual({ message: 'Offer declined' });

  expect((await prisma.application.findUnique({ where: { id: b.applicationId } })).listStatus).toBe('Primary');
  const notices = await prisma.notification.findMany({ where: { taskType: 'OfferDeclined', channel: 'InApp' } });
  expect(notices.map((n) => n.recipientId).sort()).toEqual([staff.phro.id, staff.phro2.id].sort());
  expect(notices[0].message).toMatch(new RegExp(`application #${b.applicationId}\\) has been moved to Primary`));
});

test('hides vacancies from the wrong audience but keeps them open to their own applicants', async () => {
  const vacancy = await createApprovedVacancy();
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);
  const alice = await createCandidate({ fullName: 'Alice Nakato', email: 'alice@example.com' });
  const a = await applyAs(alice, vacancy.id);
  const insider = await createCandidate({ fullName: 'Ivan Internal', email: 'ivan@caa.co.ug', candidateType: 'Internal' });
  const insiderToken = await candidateToken(insider.email);

  // An External vacancy is hidden from an Internal account...
  expect((await api(insiderToken).get(`/api/vacancies/${vacancy.id}`)).status).toBe(404);

  // ...and a Closed one from the public, but not from someone who applied.
  expectStatus(await api(tokens.phro).patch(`/api/vacancies/${vacancy.id}/close`), 200);
  expect((await api().get(`/api/vacancies/${vacancy.id}`)).status).toBe(404);
  expectStatus(await api(a.token).get(`/api/vacancies/${vacancy.id}`), 200);
  // Staff always see it.
  expectStatus(await api(tokens.hro).get(`/api/vacancies/${vacancy.id}`), 200);
});
