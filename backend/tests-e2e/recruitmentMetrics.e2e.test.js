const {
  prisma, resetDatabase, createStaff, createOrg, createCandidate, staffToken, api, expectStatus
} = require('./helpers');

// The recruitment dashboard's queries against the real schema
// (FR-ATS-070 to 074): metrics, filters and the CSV export.

let staff;
let tokens;
let org;
const ago = (d) => new Date(Date.now() - d * 86400000);

beforeEach(async () => {
  await resetDatabase();
  staff = { hro: await createStaff('HR_Officer', 'hro@caa.co.ug'), manager: await createStaff('Manager', 'manager@caa.co.ug') };
  tokens = { hro: await staffToken('hro@caa.co.ug'), manager: await staffToken('manager@caa.co.ug') };
  org = await createOrg(staff.hro.id);
  await prisma.position.update({ where: { id: org.position.id }, data: { headcount: 4, occupied: 2 } });

  const vacancy = await prisma.vacancy.create({
    data: {
      jobRef: 'UCAA/ADV/EXT/001/2026', title: 'HR Analyst', positionId: org.position.id, departmentId: org.department.id, postingType: 'External',
      status: 'PartiallyFilled', positionsRequired: 2, createdById: staff.hro.id, createdAt: ago(60), approvedAt: ago(50), approvedById: staff.manager.id,
      deadline: ago(30), location: 'Entebbe'
    }
  });
  await prisma.vacancy.create({
    data: {
      jobRef: 'UCAA/ADV/INT/001/2026', title: 'HR Analyst', positionId: org.position.id, departmentId: org.department.id, postingType: 'Internal',
      status: 'PendingApproval', positionsRequired: 1, createdById: staff.hro.id, createdAt: ago(5), approvalRequestedAt: ago(5)
    }
  });
  const make = async (i, data) => {
    const c = await createCandidate({ fullName: `Applicant ${i}`, email: `a${i}@example.com` });
    return prisma.application.create({ data: { candidateId: c.id, vacancyId: vacancy.id, ...data } });
  };
  const hired = await make(1, { status: 'Offered', submittedDate: ago(40), source: 'LinkedIn', shortlistApprovedAt: ago(25), meritApprovedAt: ago(15) });
  await prisma.interviewRound.create({ data: { applicationId: hired.id, roundNumber: 1, scheduledDate: ago(20), status: 'Completed' } });
  await prisma.offer.create({ data: { applicationId: hired.id, status: 'Accepted', approvedDate: ago(12), decidedAt: ago(10) } });
  await make(2, { status: 'Rejected', submittedDate: ago(40), source: 'LinkedIn' });
  await make(3, { status: 'UnderReview', submittedDate: ago(39), source: 'Newspaper' });
  await make(4, { status: 'Draft' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('works out every metric with its formula and rows', async () => {
  expectStatus(await api(tokens.hro).get('/api/analytics/recruitment'), 403);
  const report = expectStatus(await api(tokens.manager).get('/api/analytics/recruitment'), 200).body;
  const m = Object.fromEntries(report.metrics.map((x) => [x.key, x]));
  expect(report.metrics.every((x) => x.formula && x.source && x.refresh)).toBe(true);

  expect(m.timeToHire.value).toBe(40); // approved 50 days ago, accepted 10 days ago
  expect(m.sourceOfHire.value).toBe('LinkedIn');
  expect(m.sourceOfHire.rows.find((r) => r.source === 'LinkedIn')).toEqual(expect.objectContaining({ applicants: 2, hires: 1 }));
  expect(m.pipelineHealth.rows.map((r) => r.reached)).toEqual([3, 2, 1, 1, 1, 1]);
  expect(m.applicantsPerPosition.value).toBe(1.5);
  expect(m.selectionRatio.value).toBe(33.3);
  expect(m.openPositions.value).toBe(50); // 2 of 4 approved posts vacant
  expect(m.completionRate.value).toBe(75); // 3 of 4 started were submitted
  expect(m.requisitionAging.rows).toHaveLength(1);
  expect(m.offerOutcomes.value).toBe(100);
  expect(m.bottlenecks.rows.find((r) => r.stage === 'Raised to approved').averageDays).toBe(10);
});

test('filters by advert type and date range, and exports a CSV', async () => {
  const internal = expectStatus(await api(tokens.manager).get('/api/analytics/recruitment?postingType=Internal'), 200).body;
  expect(internal.vacancies).toBe(1);
  expect(internal.metrics.find((x) => x.key === 'timeToHire').value).toBeNull();
  const recent = expectStatus(await api(tokens.manager).get(`/api/analytics/recruitment?from=${ago(10).toISOString().slice(0, 10)}`), 200).body;
  expect(recent.vacancies).toBe(1);

  const csv = expectStatus(await api(tokens.manager).get('/api/analytics/recruitment/export?postingType=External'), 200).text;
  expect(csv).toContain('Time to hire');
  expect(csv).toContain('Applicant 1');
  expect(await prisma.auditLog.count({ where: { action: 'Recruitment dashboard exported' } })).toBe(1);
});
