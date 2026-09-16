jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const slaStatusService = require('../src/services/slaStatusService');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.taskEscalation.findFirst.mockResolvedValue(null);
  prisma.taskEscalation.count.mockResolvedValue(0);
  prisma.slaPolicy.findUnique.mockResolvedValue(null);
});

describe('getPendingTasks', () => {
  test('shapes a pending vacancy with a jobRef/title label and a vacancy-detail link', async () => {
    prisma.vacancy.findMany.mockResolvedValue([
      { id: 5, createdAt: new Date('2026-01-01T00:00:00Z'), jobRef: 'UCAA/ADV/EXT/01/2026', title: 'Accountant' }
    ]);

    const tasks = await slaStatusService.getPendingTasks('VacancyApproval');

    expect(tasks).toEqual([{
      id: 5, since: new Date('2026-01-01T00:00:00Z'),
      label: 'UCAA/ADV/EXT/01/2026 — Accountant', to: '/hr/vacancy/5'
    }]);
    expect(prisma.vacancy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { approvedAt: null, status: { not: 'Closed' } }
    }));
  });

  test('shapes a pending offer with a candidate/vacancy label and an applications-queue link', async () => {
    prisma.offer.findMany.mockResolvedValue([{
      id: 9, recommendedDate: new Date('2026-01-02T00:00:00Z'),
      application: { vacancyId: 3, candidate: { fullName: 'Dan Doe' }, vacancy: { title: 'Analyst' } }
    }]);

    const tasks = await slaStatusService.getPendingTasks('OfferApproval');

    expect(tasks).toEqual([{
      id: 9, since: new Date('2026-01-02T00:00:00Z'),
      label: 'Dan Doe — Analyst', to: '/hr/applications?vacancyId=3'
    }]);
  });

  test('shapes a pending department with a name/directorate label', async () => {
    prisma.department.findMany.mockResolvedValue([{
      id: 4, createdAt: new Date('2026-01-01T00:00:00Z'), name: 'Finance', directorate: { name: 'CORP' }
    }]);

    const tasks = await slaStatusService.getPendingTasks('DepartmentApproval');

    expect(tasks).toEqual([{
      id: 4, since: new Date('2026-01-01T00:00:00Z'), label: 'Finance (CORP)', to: '/hr/departments'
    }]);
  });
});

describe('computeStatus', () => {
  test('returns null for a task with no timestamp to measure SLA against', async () => {
    const status = await slaStatusService.computeStatus('OfferApproval', { id: 1, since: null, label: 'x', to: '/x' });
    expect(status).toBeNull();
  });

  test('a task well inside its SLA window is not overdue', async () => {
    const since = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
    prisma.slaPolicy.findUnique.mockResolvedValue({ durationHours: 48 });

    const status = await slaStatusService.computeStatus('VacancyApproval', { id: 1, since, label: 'x', to: '/x' });

    expect(status.isOverdue).toBe(false);
    expect(status.hoursRemaining).toBeGreaterThan(40);
    expect(status.escalated).toBe(false);
    expect(status.currentTier).toBe('Manager'); // INITIAL_TIER.VacancyApproval, no active escalation
  });

  test('a task past its SLA duration is overdue', async () => {
    const since = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50h ago
    prisma.slaPolicy.findUnique.mockResolvedValue({ durationHours: 48 });

    const status = await slaStatusService.computeStatus('VacancyApproval', { id: 1, since, label: 'x', to: '/x' });

    expect(status.isOverdue).toBe(true);
    expect(status.hoursRemaining).toBeLessThan(0);
  });

  test('falls back to a 48h default when no SlaPolicy row exists yet', async () => {
    const since = new Date(Date.now() - 49 * 60 * 60 * 1000); // 49h ago - overdue only under the 48h default
    prisma.slaPolicy.findUnique.mockResolvedValue(null);

    const status = await slaStatusService.computeStatus('OfferApproval', { id: 1, since, label: 'x', to: '/x' });

    expect(status.isOverdue).toBe(true);
  });

  test('an already-escalated task measures its SLA window from the escalation, at the escalated tier', async () => {
    const escalatedAt = new Date(Date.now() - 1 * 60 * 60 * 1000); // escalated 1h ago
    prisma.taskEscalation.findFirst.mockResolvedValue({ currentTier: 'Director', escalatedAt });
    prisma.taskEscalation.count.mockResolvedValue(1);
    prisma.slaPolicy.findUnique.mockResolvedValue({ durationHours: 24 });

    const status = await slaStatusService.computeStatus('VacancyApproval', {
      id: 1, since: new Date(Date.now() - 100 * 60 * 60 * 1000), label: 'x', to: '/x'
    });

    expect(status.currentTier).toBe('Director');
    expect(status.escalated).toBe(true);
    expect(status.isOverdue).toBe(false); // only 1h into a fresh 24h window at the new tier
  });
});

describe('getPendingTasksWithStatus', () => {
  test('sorts overdue tasks first, then soonest-due, across all three queues', async () => {
    prisma.slaPolicy.findUnique.mockResolvedValue({ durationHours: 48 });
    prisma.vacancy.findMany.mockResolvedValue([
      { id: 1, createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000), jobRef: 'V1', title: 'On track' } // due in 38h
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 2, createdAt: new Date(Date.now() - 60 * 60 * 60 * 1000), name: 'Overdue Dept', directorate: { name: 'CORP' } } // 12h overdue
    ]);
    prisma.offer.findMany.mockResolvedValue([
      { id: 3, recommendedDate: new Date(Date.now() - 40 * 60 * 60 * 1000), application: { vacancyId: 1, candidate: { fullName: 'A' }, vacancy: { title: 'B' } } } // due in 8h
    ]);

    const tasks = await slaStatusService.getPendingTasksWithStatus();

    expect(tasks.map((t) => `${t.taskType}:${t.taskId}`)).toEqual([
      'DepartmentApproval:2', // overdue - sorts first
      'OfferApproval:3',      // due soonest among the on-track ones
      'VacancyApproval:1'
    ]);
  });

  test('drops tasks with no timestamp instead of reporting them as infinitely overdue', async () => {
    prisma.vacancy.findMany.mockResolvedValue([{ id: 1, createdAt: null, jobRef: 'V1', title: 'No timestamp' }]);
    prisma.department.findMany.mockResolvedValue([]);
    prisma.offer.findMany.mockResolvedValue([]);

    const tasks = await slaStatusService.getPendingTasksWithStatus();

    expect(tasks).toEqual([]);
  });
});
