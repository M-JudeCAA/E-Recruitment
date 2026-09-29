const {
  prisma, resetDatabase, createStaff, createOrg, staffToken, api, expectStatus
} = require('./helpers');

// Vacancy-level rules from the September 2026 UCAA requirements: job
// reference numbering (FR-ATS-023, BR-ATS-04).

let staff;
let tokens;
let org;

beforeEach(async () => {
  await resetDatabase();
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    manager: await createStaff('Manager', 'manager@caa.co.ug')
  };
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
  org = await createOrg(staff.hro.id);
});

function createVacancy(postingType = 'External') {
  return api(tokens.hro).post('/api/vacancies', {
    positionId: org.position.id, postingType, positionsRequired: 1,
    deadline: new Date(Date.now() + 14 * 86400000).toISOString()
  });
}

test('numbers job references per posting type and year, without gaps or reuse, even when created concurrently', async () => {
  const year = new Date().getFullYear();

  const results = await Promise.all(Array.from({ length: 6 }, () => createVacancy('External')));
  const refs = results.map((r) => expectStatus(r, 201).body.jobRef).sort();
  expect(refs).toEqual([1, 2, 3, 4, 5, 6].map((n) => `UCAA/ADV/EXT/00${n}/${year}`));

  // Internal adverts have their own sequence.
  expect(expectStatus(await createVacancy('Internal'), 201).body.jobRef).toBe(`UCAA/ADV/INT/001/${year}`);

  // A deleted vacancy's number is never handed out again.
  const last = await prisma.vacancy.findFirst({ where: { jobRef: `UCAA/ADV/EXT/006/${year}` } });
  await prisma.vacancy.delete({ where: { id: last.id } });
  expect(expectStatus(await createVacancy('External'), 201).body.jobRef).toBe(`UCAA/ADV/EXT/007/${year}`);
});

test('records who changed what on a vacancy, with before and after values (FR-ATS-012)', async () => {
  const vacancy = expectStatus(await createVacancy(), 201).body;
  expectStatus(await api(tokens.hro).patch(`/api/vacancies/${vacancy.id}`, { positionsRequired: 3, salaryScale: 'U4' }), 200);

  const history = expectStatus(await api(tokens.hro).get(`/api/audit/Vacancy/${vacancy.id}`), 200).body;
  expect(history.map((h) => h.action)).toEqual(['Vacancy edited', 'Vacancy created']);
  expect(history[0].performedBy.name).toContain('HR_Officer');
  expect(history[0].changes).toEqual({
    positionsRequired: { from: 1, to: 3 }, salaryScale: { from: null, to: 'U4' }
  });
});

test('an approver returns a vacancy with a comment; HR revises and resubmits it; a rejection is final (FR-ATS-009)', async () => {
  const vacancy = expectStatus(await createVacancy(), 201).body;

  // A comment is required, and the vacancy isn't approvable while returned.
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/return`, {})).status).toBe(400);
  const returned = expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/return`, { reason: 'Salary scale should be U4' }), 200).body;
  expect(returned).toEqual(expect.objectContaining({ status: 'Returned', returnReason: 'Salary scale should be U4' }));
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`)).status).toBe(422);
  const notice = await prisma.notification.findFirst({ where: { recipientId: staff.hro.id, taskType: 'VacancyReturned' } });
  expect(notice.message).toContain('Salary scale should be U4');

  // HR revises and resubmits; the approver can then approve it.
  expectStatus(await api(tokens.hro).patch(`/api/vacancies/${vacancy.id}`, { salaryScale: 'U4' }), 200);
  expectStatus(await api(tokens.hro).patch(`/api/vacancies/${vacancy.id}/resubmit`), 200);
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);

  const history = expectStatus(await api(tokens.hro).get(`/api/audit/Vacancy/${vacancy.id}`), 200).body;
  expect(history.map((h) => h.action)).toEqual([
    'Vacancy approved', 'Vacancy resubmitted for approval', 'Vacancy edited', 'Vacancy returned for revision', 'Vacancy created'
  ]);
  expect(history[3].comment).toBe('Salary scale should be U4');

  // Closing needs a reason; moving a published deadline needs one too.
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}`, { deadline: new Date(Date.now() + 30 * 86400000).toISOString() })).status).toBe(400);
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/close`, {})).status).toBe(400);
  const closed = expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/close`, { reason: 'Position frozen' }), 200).body;
  expect(closed).toEqual(expect.objectContaining({ status: 'Closed', closeReason: 'Position frozen' }));

  // A rejected vacancy can't be resubmitted, approved or edited.
  const second = expectStatus(await createVacancy(), 201).body;
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${second.id}/reject`, { reason: 'Not in the approved establishment' }), 200);
  expect((await api(tokens.hro).patch(`/api/vacancies/${second.id}/resubmit`)).status).toBe(422);
  expect((await api(tokens.manager).patch(`/api/vacancies/${second.id}/approve`)).status).toBe(422);
  expect((await api(tokens.hro).patch(`/api/vacancies/${second.id}`, { salaryScale: 'U3' })).status).toBe(422);
});
