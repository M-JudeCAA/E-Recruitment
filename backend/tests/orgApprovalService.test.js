jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const orgApproval = require('../src/services/orgApprovalService');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.delegation.findFirst.mockResolvedValue(null);
});

describe('"Approve now"', () => {
  test('ticked unless explicitly false, as JSON or a multipart field', () => {
    expect(orgApproval.wantsAutoApprove({})).toBe(true);
    expect(orgApproval.wantsAutoApprove({ autoApprove: true })).toBe(true);
    expect(orgApproval.wantsAutoApprove({ autoApprove: 'true' })).toBe(true);
    expect(orgApproval.wantsAutoApprove({ autoApprove: false })).toBe(false);
    expect(orgApproval.wantsAutoApprove({ autoApprove: 'false' })).toBe(false);
  });

  test('only Principal HR Officer and above approve on creation', async () => {
    for (const [role, expected] of [['HR_Officer', 'Pending'], ['Senior_HR_Officer', 'Pending'], ['Principal_HR_Officer', 'Approved'], ['Manager', 'Approved'], ['Director', 'Approved']]) {
      const state = await orgApproval.initialState({ user: { id: 1, role }, body: {} });
      expect(state.data.status).toBe(expected);
    }
  });
});

describe('approving an import', () => {
  test('the person who ran it cannot approve it', async () => {
    prisma.orgImport.findUnique.mockResolvedValue({ id: 7, createdById: 3, fileName: 'org.xlsx' });
    await expect(orgApproval.approveImport({ user: { id: 3, role: 'Manager' } }, 7)).rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL' });
    expect(prisma.department.updateMany).not.toHaveBeenCalled();
  });

  test('approves every pending directorate, department and position from it together, audited on the import', async () => {
    prisma.orgImport.findUnique.mockResolvedValue({ id: 7, createdById: 1, fileName: 'org.xlsx' });
    prisma.directorate.findMany.mockResolvedValue([{ id: 2 }]);
    prisma.department.findMany.mockResolvedValue([{ id: 20 }, { id: 21 }]);
    prisma.position.findMany.mockResolvedValue([{ id: 200 }]);
    prisma.directorate.updateMany.mockResolvedValue({ count: 1 });
    prisma.department.updateMany.mockResolvedValue({ count: 2 });
    prisma.position.updateMany.mockResolvedValue({ count: 1 });

    const result = await orgApproval.approveImport({ user: { id: 3, role: 'Principal_HR_Officer' } }, 7);

    const where = { importId: 7, status: 'Pending' };
    for (const model of ['directorate', 'department', 'position']) {
      expect(prisma[model].updateMany).toHaveBeenCalledWith({ where, data: expect.objectContaining({ status: 'Approved', approvedById: 3 }) });
    }
    expect(result).toEqual({ directorates: 1, departments: 2, positions: 1, departmentIds: [20, 21] });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'OrgImport', entityId: 7, action: 'Approved import', performedById: 3,
      payload: expect.objectContaining({ comment: expect.stringMatching(/1 directorate\(s\), 2 department\(s\) and 1 position\(s\) from org\.xlsx/) })
    }) });
  });

  test('says so when nothing from it is waiting', async () => {
    prisma.orgImport.findUnique.mockResolvedValue({ id: 7, createdById: 1, fileName: 'org.xlsx' });
    prisma.directorate.findMany.mockResolvedValue([]);
    prisma.department.findMany.mockResolvedValue([]);
    prisma.position.findMany.mockResolvedValue([]);
    await expect(orgApproval.approveImport({ user: { id: 3, role: 'Manager' } }, 7)).rejects.toMatchObject({ status: 422 });
  });
});

test('a position is usable only when it, its department and its directorate are all approved', () => {
  const ok = { status: 'Approved', department: { status: 'Approved', directorate: { status: 'Approved' } } };
  expect(orgApproval.usablePosition(ok)).toBe(true);
  expect(orgApproval.usablePosition({ ...ok, status: 'Pending' })).toBe(false);
  expect(orgApproval.usablePosition({ ...ok, department: { ...ok.department, status: 'Rejected' } })).toBe(false);
  expect(orgApproval.usablePosition({ ...ok, department: { status: 'Approved', directorate: { status: 'Pending' } } })).toBe(false);
});

test('the organisation history reads the org audit rows, with whether "Approve now" was used', async () => {
  prisma.auditLog.findMany.mockResolvedValue([{
    id: 1, entityType: 'Position', entityId: 5, action: 'Created and approved (Approve now)', timestamp: new Date(0),
    performedBy: { id: 3, name: 'P. Officer', role: 'Principal_HR_Officer' }, actingAsId: null,
    payload: { name: 'CWG Officer', autoApproved: true, comment: 'Approved on creation', changes: { status: { from: null, to: 'Approved' } } }
  }]);
  const rows = await orgApproval.history();
  expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { entityType: { in: ['Directorate', 'Department', 'Position', 'OrgImport'] } }
  }));
  expect(rows).toEqual([expect.objectContaining({ entityType: 'Position', name: 'CWG Officer', autoApproved: true, comment: 'Approved on creation' })]);
  expect(rows[0].changes).toBeUndefined();
});
