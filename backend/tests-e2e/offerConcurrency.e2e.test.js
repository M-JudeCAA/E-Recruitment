const {
  prisma, resetDatabase, createStaff, createOrg, createCandidate,
  staffToken, candidateToken, api, expectStatus
} = require('./helpers');

// Offer acceptance under real concurrency. Before 24 September 2026, two
// candidates accepting offers for the same one-position vacancy at the same
// moment could both succeed. Acceptance now locks the vacancy row first
// (workflowService.acceptOfferTransactionally); these tests fire the
// acceptances in parallel against a real MySQL database to prove only one
// can win, and cover what HR is told and can do about the loser.

const VACANCIES = 5;

let phro;
let phroToken;

beforeEach(async () => {
  await resetDatabase();
  const hro = await createStaff('HR_Officer', 'hro@caa.co.ug');
  const manager = await createStaff('Manager', 'manager@caa.co.ug');
  phro = await createStaff('Principal_HR_Officer', 'phro@caa.co.ug');
  phroToken = await staffToken(phro.email);
  const org = await createOrg(hro.id);
  // Stored on the module scope for the tests below.
  global.e2eSetup = { hro, manager, org };
});

afterAll(async () => {
  await prisma.$disconnect();
});

// A one-position vacancy with two candidates who both hold an Approved offer,
// written straight to the database: the lock only depends on this state, and
// building it through the API would add nothing but time.
async function vacancyWithTwoApprovedOffers(n) {
  const { hro, manager, org } = global.e2eSetup;
  const vacancy = await prisma.vacancy.create({
    data: {
      jobRef: `UCAA/ADV/EXT/09/2026-${n}`, title: 'HR Analyst', positionId: org.position.id, departmentId: org.department.id,
      postingType: 'External', status: 'Open', positionsRequired: 1, createdById: hro.id,
      approvedById: manager.id, approvedAt: new Date(), deadline: new Date(Date.now() + 86400000)
    }
  });
  const offers = [];
  for (const i of [1, 2]) {
    const candidate = await createCandidate({ fullName: `Candidate ${n}-${i}`, email: `c${n}-${i}@example.com` });
    const application = await prisma.application.create({
      data: { candidateId: candidate.id, vacancyId: vacancy.id, status: 'Offered', submittedDate: new Date(), rank: i, listStatus: i === 1 ? 'Primary' : 'Reserve' }
    });
    const offer = await prisma.offer.create({
      data: { applicationId: application.id, status: 'Approved', recommendedById: phro.id, approvedById: manager.id, approvedDate: new Date(), recommendedDate: new Date() }
    });
    offers.push({ offer, candidate, token: await candidateToken(candidate.email) });
  }
  return { vacancy, offers };
}

test('only one of two simultaneous acceptances for a one-position vacancy succeeds', async () => {
  const setups = [];
  for (let n = 1; n <= VACANCIES; n++) setups.push(await vacancyWithTwoApprovedOffers(n));

  // Every candidate on every vacancy accepts at the same moment.
  const attempts = setups.flatMap(({ vacancy, offers }) => offers.map((o) => ({ vacancy, ...o })));
  const responses = await Promise.all(attempts.map((a) => api(a.token).patch(`/api/applications/offers/${a.offer.id}/accept`)));

  for (const { vacancy } of setups) {
    const statuses = attempts.map((a, i) => ({ a, res: responses[i] })).filter(({ a }) => a.vacancy.id === vacancy.id);
    expect(statuses.map(({ res }) => res.status).sort()).toEqual([200, 409]);
    const refused = statuses.find(({ res }) => res.status === 409).res;
    expect(refused.body.error).toMatch(/already been filled/);

    expect(await prisma.offer.count({ where: { status: 'Accepted', application: { vacancyId: vacancy.id } } })).toBe(1);
    expect((await prisma.vacancy.findUnique({ where: { id: vacancy.id } })).status).toBe('Filled');
  }

  // HR hears about every offer that can no longer be accepted.
  const notices = await prisma.notification.findMany({ where: { recipientId: phro.id, taskType: 'VacancyFilledWithOpenOffers', channel: 'InApp' } });
  expect(notices.length).toBeGreaterThanOrEqual(VACANCIES);
});

test('HR can withdraw an offer left open on a filled vacancy, and the candidate is told', async () => {
  const { vacancy, offers: [winner, loser] } = await vacancyWithTwoApprovedOffers(1);
  expectStatus(await api(winner.token).patch(`/api/applications/offers/${winner.offer.id}/accept`), 200);

  // The winner filled the vacancy, so HR is told the other offer is stranded.
  const [notice] = await prisma.notification.findMany({ where: { taskType: 'VacancyFilledWithOpenOffers', channel: 'InApp' } });
  expect(notice.taskId).toBe(vacancy.id);
  expect(notice.message).toMatch(/Candidate 1-2 \(application #\d+, offer Approved\)/);

  const res = expectStatus(await api(phroToken).patch(`/api/applications/offers/${loser.offer.id}/withdraw`, { reason: 'The position has been filled' }), 200);
  expect(res.body.status).toBe('Withdrawn');

  const told = await prisma.candidateNotification.findFirst({ where: { candidateId: loser.candidate.id, type: 'OfferWithdrawn', channel: 'InApp' } });
  expect(told.message).toMatch(/has been withdrawn\. Reason given: The position has been filled/);
  const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Offer', entityId: loser.offer.id, action: 'Offer withdrawn' } });
  expect(audit.performedById).toBe(phro.id);

  // A withdrawn offer can't be accepted, or withdrawn twice.
  expect((await api(loser.token).patch(`/api/applications/offers/${loser.offer.id}/accept`)).status).toBe(422);
  expect((await api(phroToken).patch(`/api/applications/offers/${loser.offer.id}/withdraw`)).status).toBe(422);
});
