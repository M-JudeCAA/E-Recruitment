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
