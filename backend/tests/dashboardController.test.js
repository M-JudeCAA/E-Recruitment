jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const dashboardController = require('../src/controllers/dashboardController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.vacancy.count.mockResolvedValue(0);
  prisma.application.count.mockResolvedValue(0);
  prisma.department.count.mockResolvedValue(0);
  prisma.offer.count.mockResolvedValue(0);
  prisma.vacancy.findMany.mockResolvedValue([]);
  prisma.offer.findMany.mockResolvedValue([]);
  prisma.department.findMany.mockResolvedValue([]);
});

describe('summary', () => {
  test('shapes per-status counts into objects keyed by status', async () => {
    prisma.vacancy.count.mockImplementation(({ where }) => {
      if (where.status === 'Open') return Promise.resolve(4);
      if (where.status === 'PendingApproval') return Promise.resolve(2);
      return Promise.resolve(0);
    });
    prisma.application.count.mockImplementation(({ where }) => {
      if (where.status === 'Submitted') return Promise.resolve(7);
      return Promise.resolve(0);
    });
    prisma.department.count.mockResolvedValue(3);
    prisma.offer.count.mockImplementation(({ where }) => {
      if (where.status === 'Recommended') return Promise.resolve(5);
      if (where.status === 'Accepted') return Promise.resolve(8);
      return Promise.resolve(0);
    });

    const req = {};
    const res = mockRes();
    await dashboardController.summary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      vacanciesByStatus: expect.objectContaining({ Open: 4, PendingApproval: 2, Closed: 0 }),
      applicationsByStatus: expect.objectContaining({ Submitted: 7, Rejected: 0 }),
      offersByStatus: expect.objectContaining({ Recommended: 5, Accepted: 8, Declined: 0 }),
      pendingDepartments: 3,
      offersPendingApproval: 5
    });
  });
});

describe('trends', () => {
  test('buckets each series into one zero-filled count per day over the requested window', async () => {
    prisma.application.findMany.mockResolvedValue([
      { createdAt: new Date() }, { createdAt: new Date() } // both today
    ]);
    prisma.vacancy.findMany.mockResolvedValue([{ approvedAt: new Date() }]);
    prisma.offer.findMany.mockResolvedValue([]);

    const req = { query: { days: '7' } };
    const res = mockRes();
    await dashboardController.trends(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.days).toBe(7);
    expect(body.applicationsSubmitted).toHaveLength(7);
    expect(body.applicationsSubmitted.at(-1).count).toBe(2); // today is the last bucket
    expect(body.vacanciesApproved.at(-1).count).toBe(1);
    expect(body.offersApproved.every((d) => d.count === 0)).toBe(true);
  });

  test('falls back to 30 days for an unsupported ?days value', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    prisma.vacancy.findMany.mockResolvedValue([]);
    prisma.offer.findMany.mockResolvedValue([]);

    const req = { query: { days: '9999' } };
    const res = mockRes();
    await dashboardController.trends(req, res);

    expect(res.json.mock.calls[0][0].days).toBe(30);
  });
});

describe('followUps', () => {
  test('delegates to slaStatusService and returns its result as-is', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    prisma.department.findMany.mockResolvedValue([]);
    prisma.offer.findMany.mockResolvedValue([]);

    const req = {};
    const res = mockRes();
    await dashboardController.followUps(req, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('slaPolicies', () => {
  test('returns every configured SLA policy', async () => {
    prisma.slaPolicy.findMany.mockResolvedValue([{ id: 1, taskType: 'VacancyApproval', tier: 'Manager', durationHours: 48 }]);

    const req = {};
    const res = mockRes();
    await dashboardController.slaPolicies(req, res);

    expect(res.json).toHaveBeenCalledWith([{ id: 1, taskType: 'VacancyApproval', tier: 'Manager', durationHours: 48 }]);
  });
});

describe('upcomingInterviews', () => {
  test('shapes rounds scheduled within the window, defaulting to 7 days', async () => {
    prisma.interviewRound.findMany.mockResolvedValue([{
      id: 1, scheduledDate: new Date('2026-01-05T10:00:00Z'), mode: 'Virtual', roundNumber: 1,
      application: { candidate: { fullName: 'Dan Doe' }, vacancy: { id: 3, title: 'Analyst', jobRef: 'UCAA/ADV/EXT/01/2026' } }
    }]);

    const req = { query: {} };
    const res = mockRes();
    await dashboardController.upcomingInterviews(req, res);

    expect(prisma.interviewRound.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scheduledDate: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }) }
    }));
    expect(res.json).toHaveBeenCalledWith([{
      id: 1, scheduledDate: new Date('2026-01-05T10:00:00Z'), mode: 'Virtual', roundNumber: 1,
      candidateName: 'Dan Doe', vacancyId: 3, vacancyTitle: 'Analyst', jobRef: 'UCAA/ADV/EXT/01/2026'
    }]);
  });

  test('falls back to 7 days for an invalid ?days value', async () => {
    prisma.interviewRound.findMany.mockResolvedValue([]);
    const req = { query: { days: 'not-a-number' } };
    const res = mockRes();
    await dashboardController.upcomingInterviews(req, res);

    const call = prisma.interviewRound.findMany.mock.calls[0][0];
    const spanDays = (call.where.scheduledDate.lte - call.where.scheduledDate.gte) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeCloseTo(7, 5);
  });
});

describe('screeningBreakdown', () => {
  test('counts outcomes and categorizes failure reasons', async () => {
    prisma.application.count.mockImplementation(({ where }) => {
      if (where.screeningPassed === true) return Promise.resolve(5);
      if (where.screeningPassed === false) return Promise.resolve(3);
      if (where.screeningPassed === null) return Promise.resolve(2);
      return Promise.resolve(0);
    });
    prisma.application.findMany.mockResolvedValue([
      { screeningReasons: JSON.stringify(['Below minimum education level (requires Bachelors, has Diploma)']) },
      { screeningReasons: JSON.stringify(['Below minimum experience (1.0 yrs vs 3 required)', 'Missing referees']) },
      { screeningReasons: 'not valid json' } // must not throw
    ]);

    const req = {};
    const res = mockRes();
    await dashboardController.screeningBreakdown(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.passed).toBe(5);
    expect(body.failed).toBe(3);
    expect(body.notYetScreened).toBe(2);
    expect(body.topReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'education', count: 1 }),
      expect.objectContaining({ key: 'experience', count: 1 }),
      expect.objectContaining({ key: 'referees', count: 1 })
    ]));
  });
});

describe('activity', () => {
  test('merges vacancy approvals, transitions, offer approvals, and department approvals into one reverse-chronological feed', async () => {
    prisma.vacancy.findMany.mockImplementation(({ where }) => {
      if (where.approvedAt) {
        return Promise.resolve([{
          id: 1, jobRef: 'UCAA/ADV/EXT/01/2026', title: 'Accountant',
          approvedAt: new Date('2026-01-10T10:00:00Z'), approvedByRole: 'Manager',
          approvedBy: { name: 'Alice' }
        }]);
      }
      if (where.postingTypeChangedAt) {
        return Promise.resolve([{
          id: 2, jobRef: 'UCAA/ADV/INT/01/2026', title: 'Engineer',
          postingType: 'External', postingTypePreviousValue: 'Internal',
          postingTypeChangedAt: new Date('2026-01-12T10:00:00Z'),
          postingTypeChangedBy: { name: 'Bob' }
        }]);
      }
      return Promise.resolve([]);
    });
    prisma.offer.findMany.mockResolvedValue([{
      id: 3, approvedDate: new Date('2026-01-05T10:00:00Z'),
      approvedBy: { name: 'Carol' },
      application: { candidate: { fullName: 'Dan Doe' }, vacancy: { title: 'Analyst', jobRef: 'UCAA/ADV/EXT/02/2026' } }
    }]);
    prisma.department.findMany.mockResolvedValue([{
      id: 4, name: 'Finance', approvedAt: new Date('2026-01-01T10:00:00Z'),
      approvedBy: { name: 'Eve' }, directorate: { name: 'CORP' }
    }]);

    const req = {};
    const res = mockRes();
    await dashboardController.activity(req, res);

    const items = res.json.mock.calls[0][0];
    expect(items.map((i) => i.type)).toEqual([
      'PostingTypeTransition', 'VacancyApproved', 'OfferApproved', 'DepartmentApproved'
    ]);
    expect(items[0].actor).toBe('Bob');
  });
});

describe('headcountByDirectorate', () => {
  test('groups positionsRequired by directorate and vacancy status', async () => {
    prisma.vacancy.findMany.mockResolvedValue([
      { positionsRequired: 2, status: 'Open', department: { directorate: { name: 'CORP' } } },
      { positionsRequired: 1, status: 'Filled', department: { directorate: { name: 'CORP' } } },
      { positionsRequired: 3, status: 'PartiallyFilled', department: { directorate: { name: 'DANS' } } }
    ]);

    const req = {};
    const res = mockRes();
    await dashboardController.headcountByDirectorate(req, res);

    expect(res.json).toHaveBeenCalledWith([
      { directorate: 'CORP', Open: 2, PartiallyFilled: 0, Filled: 1, totalPositions: 3 },
      { directorate: 'DANS', Open: 0, PartiallyFilled: 3, Filled: 0, totalPositions: 3 }
    ]);
  });
});
