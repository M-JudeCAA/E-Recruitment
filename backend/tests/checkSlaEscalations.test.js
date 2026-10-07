jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/services/notificationService', () => ({ notifyAllWithRole: jest.fn() }));

const prisma = require('../src/config/db');
const { notifyAllWithRole } = require('../src/services/notificationService');
const { run } = require('../scripts/checkSlaEscalations');

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  for (const model of ['vacancy', 'department', 'directorate', 'position', 'offer']) prisma[model].findMany.mockResolvedValue([]);
  prisma.taskEscalation.findFirst.mockResolvedValue(null);
  prisma.slaPolicy.findUnique.mockResolvedValue({ durationHours: 48 });
});

test('an overdue directorate or position escalates from Principal HR Officer to Manager, with a notice', async () => {
  prisma.directorate.findMany.mockResolvedValue([{ id: 2, createdAt: hoursAgo(50), name: 'DSSER', importId: null }]);
  prisma.position.findMany.mockResolvedValue([
    { id: 7, createdAt: hoursAgo(10), name: 'Clerk', importId: null, department: { name: 'HR', directorate: { name: 'DHRA' } } } // not due yet
  ]);

  const summary = await run();

  expect(prisma.taskEscalation.create).toHaveBeenCalledTimes(1);
  expect(prisma.taskEscalation.create).toHaveBeenCalledWith({ data: { taskType: 'DirectorateApproval', taskId: 2, currentTier: 'Manager' } });
  expect(notifyAllWithRole).toHaveBeenCalledWith('Manager', 'DirectorateApproval', 2, expect.stringMatching(/directorate approval \(Directorate DSSER\) has been waiting 50h/));
  expect(summary).toMatch(/1 task\(s\) escalated/);
});

test('one import\'s overdue items escalate one by one but notify once', async () => {
  const fromImport = { importId: 3, import: { fileName: 'org.xlsx' } };
  prisma.department.findMany.mockResolvedValue([{ id: 20, createdAt: hoursAgo(60), name: 'Payroll', directorate: { name: 'DF' }, ...fromImport }]);
  prisma.position.findMany.mockResolvedValue([
    { id: 30, createdAt: hoursAgo(60), name: 'Payroll Officer', department: { name: 'Payroll', directorate: { name: 'DF' } }, ...fromImport },
    { id: 31, createdAt: hoursAgo(60), name: 'Payroll Manager', department: { name: 'Payroll', directorate: { name: 'DF' } }, ...fromImport }
  ]);

  await run();

  expect(prisma.taskEscalation.create).toHaveBeenCalledTimes(3);
  expect(notifyAllWithRole).toHaveBeenCalledTimes(1);
  expect(notifyAllWithRole).toHaveBeenCalledWith('Manager', 'DepartmentApproval', 20, expect.stringMatching(/^3 item\(s\) imported from org\.xlsx have been waiting 60h/));
});

test('already escalated to the top tier: nothing more happens', async () => {
  prisma.position.findMany.mockResolvedValue([{ id: 7, createdAt: hoursAgo(500), name: 'Clerk', importId: null, department: { name: 'HR', directorate: { name: 'DHRA' } } }]);
  prisma.taskEscalation.findFirst.mockResolvedValue({ currentTier: 'Director', escalatedAt: hoursAgo(100) });

  await run();

  expect(prisma.taskEscalation.create).not.toHaveBeenCalled();
  expect(notifyAllWithRole).not.toHaveBeenCalled();
});
