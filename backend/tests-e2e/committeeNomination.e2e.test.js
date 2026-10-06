const {
  prisma, resetDatabase, createStaff, createOrg, staffToken, api, expectStatus, createVacancyFromRequisition
} = require('./helpers');

// The shortlisting committee's nomination goes to the DHRA (a Director)
// before rating can open (FR-ATS-046); members' access ends on a set date
// (FR-ATS-048).

let staff;
let tokens;
let vacancy;
let base;

beforeEach(async () => {
  await resetDatabase();
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    shro: await createStaff('Senior_HR_Officer', 'shro@caa.co.ug'),
    manager: await createStaff('Manager', 'manager@caa.co.ug'),
    dhra: await createStaff('Director', 'dhra@caa.co.ug')
  };
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
  const org = await createOrg(staff.hro.id);
  vacancy = expectStatus(await createVacancyFromRequisition(tokens.hro, {
    positionId: org.position.id, postingType: 'External', positionsRequired: 1,
    deadline: new Date(Date.now() + 14 * 86400000).toISOString()
  }), 201).body;
  await prisma.vacancy.update({ where: { id: vacancy.id }, data: { status: 'Open', reviewStartedAt: new Date(), deadline: new Date(Date.now() - 86400000) } });
  base = `/api/shortlist-committee/vacancies/${vacancy.id}`;
  expectStatus(await api(tokens.shro).post(base, {}), 200);
  expectStatus(await api(tokens.shro).patch(base, { criteria: [{ kind: 'Essential', label: 'Relevant degree', weight: 1 }] }), 200);
  for (const [i, name] of ['Chair Person', 'Member Two', 'Member Three'].entries()) {
    expectStatus(await api(tokens.shro).post(`${base}/members`, { name, email: `m${i}@caa.co.ug`, isChair: i === 0 }), 200);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('rating opens only after the DHRA approves; while it is with them only the DHRA changes the members', async () => {
  // Not yet approved.
  expect(expectStatus(await api(tokens.shro).post(`${base}/open`, {}), 422).body.code).toBe('NOMINATION_NOT_APPROVED');

  // Submitted: every Director is told; HR can no longer change the members.
  expect(expectStatus(await api(tokens.shro).post(`${base}/nomination/submit`, {}), 200).body.exercise.nominationStatus).toBe('Submitted');
  expect(await prisma.notification.count({ where: { recipientId: staff.dhra.id, taskType: 'CommitteeNominationSubmitted', channel: 'InApp' } })).toBe(1);
  expect(expectStatus(await api(tokens.shro).post(`${base}/members`, { name: 'Late Addition', email: 'late@caa.co.ug' }), 409).body.code).toBe('NOMINATION_PENDING');

  // A Manager can't decide it; the DHRA replaces a member, then approves.
  expectStatus(await api(tokens.manager).post(`${base}/nomination/approve`, {}), 403);
  const before = expectStatus(await api(tokens.dhra).get(base), 200).body.exercise;
  const two = before.members.find((m) => m.name === 'Member Two');
  expectStatus(await api(tokens.dhra).patch(`${base}/members/${two.id}`, { name: 'Internal Auditor', email: 'audit@caa.co.ug' }), 200);
  const approved = expectStatus(await api(tokens.dhra).post(`${base}/nomination/approve`, {}), 200).body.exercise;
  expect(approved.nominationStatus).toBe('Approved');
  expect(approved.nominationDecidedBy.id).toBe(staff.dhra.id);
  expect(await prisma.notification.count({ where: { recipientId: staff.shro.id, taskType: 'CommitteeNominationDecided', channel: 'InApp' } })).toBe(1);

  const actions = (await prisma.auditLog.findMany({ where: { entityType: 'Vacancy', entityId: vacancy.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining([
    'Committee nomination submitted to the DHRA', 'DHRA replaced or edited a committee member', 'Committee nomination approved by the DHRA'
  ]));

  // An HR change after approval sends it back for approval.
  expectStatus(await api(tokens.shro).post(`${base}/members`, { name: 'One More', email: 'more@caa.co.ug' }), 200);
  expect((await prisma.shortlistExercise.findUnique({ where: { vacancyId: vacancy.id } })).nominationStatus).toBe('Draft');
});

test('the DHRA returns a nomination with a reason; the Approvals Center lists those waiting', async () => {
  expectStatus(await api(tokens.shro).post(`${base}/nomination/submit`, {}), 200);
  const pending = expectStatus(await api(tokens.dhra).get('/api/shortlist-committee/nominations/pending'), 200).body;
  expect(pending).toHaveLength(1);
  expect(pending[0].members).toHaveLength(3);
  expect((await api(tokens.manager).get('/api/shortlist-committee/nominations/pending')).status).toBe(403);

  expectStatus(await api(tokens.dhra).post(`${base}/nomination/return`, { reason: 'short' }), 400);
  const returned = expectStatus(await api(tokens.dhra).post(`${base}/nomination/return`, { reason: 'Please add someone from Internal Audit' }), 200).body.exercise;
  expect(returned).toEqual(expect.objectContaining({ nominationStatus: 'Returned', nominationReturnReason: 'Please add someone from Internal Audit' }));
  // HR can change it and submit again.
  expectStatus(await api(tokens.shro).post(`${base}/members`, { name: 'Internal Auditor', email: 'audit@caa.co.ug' }), 200);
  expectStatus(await api(tokens.shro).post(`${base}/nomination/submit`, {}), 200);
});

test("members' links stop working once their access end has passed", async () => {
  expectStatus(await api(tokens.shro).post(`${base}/nomination/submit`, {}), 200);
  expectStatus(await api(tokens.dhra).post(`${base}/nomination/approve`, {}), 200);
  await prisma.application.create({ data: { candidate: { create: { fullName: 'A Candidate', email: 'cand@example.com', candidateType: 'External' } }, vacancy: { connect: { id: vacancy.id } }, status: 'UnderReview', submittedDate: new Date() } });
  expectStatus(await api(tokens.shro).post(`${base}/open`, {}), 200);
  const member = await prisma.shortlistMember.findFirst({ where: { isChair: true } });
  expectStatus(await api().get(`/api/shortlist-panel/${member.token}`), 200);
  await prisma.shortlistExercise.update({ where: { vacancyId: vacancy.id }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
  expectStatus(await api().get(`/api/shortlist-panel/${member.token}`), 410);
});
