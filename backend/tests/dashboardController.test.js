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
    prisma.offer.count.mockResolvedValue(5);

    const req = {};
    const res = mockRes();
    await dashboardController.summary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      vacanciesByStatus: expect.objectContaining({ Open: 4, PendingApproval: 2, Closed: 0 }),
      applicationsByStatus: expect.objectContaining({ Submitted: 7, Rejected: 0 }),
      pendingDepartments: 3,
      offersPendingApproval: 5
    });
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
