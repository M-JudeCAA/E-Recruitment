jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const { toPublicVacancy, STAFF_ONLY_VACANCY_FIELDS } = require('../src/utils/publicVacancy');
const candidateController = require('../src/controllers/candidateController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('toPublicVacancy', () => {
  test('removes every staff-only field and keeps advert content', () => {
    const vacancy = { id: 1, title: 'Officer', salaryScale: 'U4', deadline: '2026-10-01' };
    for (const field of STAFF_ONLY_VACANCY_FIELDS) vacancy[field] = 'secret';

    const result = toPublicVacancy(vacancy);

    for (const field of STAFF_ONLY_VACANCY_FIELDS) expect(result).not.toHaveProperty(field);
    expect(result).toEqual({ id: 1, title: 'Officer', salaryScale: 'U4', deadline: '2026-10-01' });
  });

  test('does not mutate the original object', () => {
    const vacancy = { id: 1, recruiterNotes: 'keep me' };
    toPublicVacancy(vacancy);
    expect(vacancy.recruiterNotes).toBe('keep me');
  });

  test('passes null through unchanged', () => {
    expect(toPublicVacancy(null)).toBeNull();
  });
});

describe('candidateController.myApplications', () => {
  test('strips HR-only vacancy fields from each of the candidate\'s applications', async () => {
    prisma.application.findMany.mockResolvedValue([
      { id: 10, status: 'Submitted', vacancy: { id: 1, title: 'A', internalSalaryRange: '10-12M', recruiterNotes: 'n' } },
      { id: 11, status: 'Offered', vacancy: { id: 2, title: 'B', approvedByRole: 'Director' } }
    ]);
    const res = mockRes();

    await candidateController.myApplications({ user: { id: 7 } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.map((a) => a.id)).toEqual([10, 11]);
    expect(body[0].vacancy).toEqual({ id: 1, title: 'A' });
    expect(body[1].vacancy).toEqual({ id: 2, title: 'B' });
  });
});
