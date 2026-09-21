jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const analyticsController = require('../src/controllers/analyticsController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// UTC 'YYYY-MM' for the current month - every test resolves its fixtures
// "this month" so the default 6-month window always includes them
// regardless of when the suite runs.
function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
function thisMonth(day) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.vacancy.findMany.mockResolvedValue([]);
  prisma.department.findMany.mockResolvedValue([]);
  prisma.offer.findMany.mockResolvedValue([]);
  prisma.taskEscalation.findMany.mockResolvedValue([]);
  prisma.delegationUsage.findMany.mockResolvedValue([]);
  prisma.panelMember.findMany.mockResolvedValue([]);
});

describe('slaCompliance', () => {
  test('buckets resolved tasks into compliant/breached by month of resolution', async () => {
    prisma.vacancy.findMany.mockResolvedValue([
      { id: 1, createdAt: thisMonth(1), approvedAt: thisMonth(3), approvedById: 9, approvedBy: { name: 'Mary Manager' } }
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 2, createdAt: thisMonth(1), approvedAt: thisMonth(5), approvedById: 9, approvedBy: { name: 'Mary Manager' } }
    ]);
    prisma.taskEscalation.findMany.mockResolvedValue([{ taskType: 'DepartmentApproval', taskId: 2 }]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.slaCompliance(req, res);

    const body = res.json.mock.calls[0][0];
    const bucket = body.find((b) => b.month === currentMonthKey());
    expect(bucket).toEqual({ month: currentMonthKey(), compliant: 1, breached: 1, complianceRate: 50 });
  });

  test('a month with no resolved tasks reports a null rate, not a divide-by-zero', async () => {
    const req = { query: { months: '3' } };
    const res = mockRes();
    await analyticsController.slaCompliance(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body).toHaveLength(3);
    expect(body.every((b) => b.complianceRate === null)).toBe(true);
  });
});

describe('approvalTurnaround', () => {
  test('averages hours-to-resolve per approver, sorted slowest-first', async () => {
    prisma.vacancy.findMany.mockResolvedValue([
      { id: 1, createdAt: thisMonth(1), approvedAt: thisMonth(2), approvedById: 9, approvedBy: { name: 'Fast Approver' } } // 24h
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 2, createdAt: thisMonth(1), approvedAt: thisMonth(6), approvedById: 8, approvedBy: { name: 'Slow Approver' } } // 120h
    ]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.approvalTurnaround(req, res);

    expect(res.json).toHaveBeenCalledWith([
      { approver: 'Slow Approver', count: 1, avgHours: 120 },
      { approver: 'Fast Approver', count: 1, avgHours: 24 }
    ]);
  });

  test('drops a task with no since/resolvedAt timestamp instead of computing a nonsensical duration', async () => {
    prisma.offer.findMany.mockResolvedValue([
      { id: 1, recommendedDate: null, approvedDate: thisMonth(2), approvedById: 1, approvedBy: { name: 'X' } }
    ]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.approvalTurnaround(req, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('offerOutcomes', () => {
  test('splits decided offers into Accepted/Declined per month with an acceptance rate', async () => {
    prisma.offer.findMany.mockResolvedValue([
      { decidedAt: thisMonth(1), status: 'Accepted' },
      { decidedAt: thisMonth(2), status: 'Accepted' },
      { decidedAt: thisMonth(3), status: 'Declined' }
    ]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.offerOutcomes(req, res);

    const bucket = res.json.mock.calls[0][0].find((b) => b.month === currentMonthKey());
    expect(bucket).toEqual({ month: currentMonthKey(), Accepted: 2, Declined: 1, acceptanceRate: 67 });
  });
});

describe('hiringMix', () => {
  test('splits filled vacancies into Internal/External per month', async () => {
    prisma.vacancy.findMany.mockResolvedValue([
      { filledAt: thisMonth(1), approvedAt: thisMonth(-10), postingType: 'Internal' },
      { filledAt: thisMonth(2), approvedAt: thisMonth(-10), postingType: 'External' },
      { filledAt: thisMonth(3), approvedAt: thisMonth(-10), postingType: 'External' }
    ]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.hiringMix(req, res);

    const bucket = res.json.mock.calls[0][0].find((b) => b.month === currentMonthKey());
    expect(bucket).toEqual({ month: currentMonthKey(), Internal: 1, External: 2 });
  });
});

describe('timeToFill', () => {
  test('computes an overall average and a monthly trend from approvedAt -> filledAt', async () => {
    prisma.vacancy.findMany.mockResolvedValue([
      { filledAt: thisMonth(11), approvedAt: thisMonth(1), postingType: 'External' }, // 10 days
      { filledAt: thisMonth(21), approvedAt: thisMonth(1), postingType: 'Internal' }  // 20 days
    ]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.timeToFill(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.overallAvgDays).toBe(15);
    expect(body.filledCount).toBe(2);
    const bucket = body.trend.find((b) => b.month === currentMonthKey());
    expect(bucket).toEqual({ month: currentMonthKey(), avgDays: 15, count: 2 });
  });

  test('reports null/zero for no filled vacancies rather than dividing by zero', async () => {
    const req = { query: {} };
    const res = mockRes();
    await analyticsController.timeToFill(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.overallAvgDays).toBeNull();
    expect(body.filledCount).toBe(0);
  });
});

describe('delegationActivity', () => {
  test('shapes recent delegation usage with delegator/delegate names resolved', async () => {
    prisma.delegationUsage.findMany.mockResolvedValue([
      { id: 1, action: 'PATCH /api/vacancies/5/approve', usedAt: thisMonth(1), delegation: { delegator: { name: 'Carol Director' }, delegate: { name: 'Alice HR' } } }
    ]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.delegationActivity(req, res);

    expect(res.json).toHaveBeenCalledWith([
      { id: 1, action: 'PATCH /api/vacancies/5/approve', usedAt: thisMonth(1), delegatorName: 'Carol Director', delegateName: 'Alice HR' }
    ]);
  });
});

describe('panelWorkload', () => {
  test('groups scored rounds by panelist name and averages the score', async () => {
    prisma.panelMember.findMany.mockResolvedValue([
      { name: 'Dr. Okello', score: 80 },
      { name: 'Dr. Okello', score: 90 },
      { name: 'Ms. Akello', score: 70 }
    ]);

    const req = { query: {} };
    const res = mockRes();
    await analyticsController.panelWorkload(req, res);

    expect(res.json).toHaveBeenCalledWith([
      { name: 'Dr. Okello', roundsScored: 2, avgScore: 85 },
      { name: 'Ms. Akello', roundsScored: 1, avgScore: 70 }
    ]);
  });
});
