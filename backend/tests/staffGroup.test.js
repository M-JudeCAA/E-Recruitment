jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/services/directoryService', () => ({
  isConfigured: jest.fn(() => true),
  addGroupMember: jest.fn(),
  removeGroupMember: jest.fn(),
  findUserIdByEmail: jest.fn(),
  groupMemberIds: jest.fn(),
  staffAppAssignments: jest.fn(),
  searchPeople: jest.fn()
}));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const directory = require('../src/services/directoryService');
const staffGroup = require('../src/services/staffGroupService');
const controller = require('../src/controllers/staffUserController');
const { linkFor } = require('../src/utils/notificationLinks');

const GROUP = '11111111-2222-3333-4444-555555555555';
const OID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const admin = { type: 'staff', id: 90, role: null, isSystemAdmin: true };

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Accounts by id, updated in place by staffUser.update.
let rows;
const account = (extra = {}) => ({
  id: 7, name: 'Grace Achieng', email: 'grace@caa.co.ug', role: 'HR_Officer', department: 'HR', isSystemAdmin: false,
  active: true, entraObjectId: OID, lastLoginAt: null, entraGroupState: null, ...extra
});
const graphError = (status, message = '') => Object.assign(new Error(`Graph ${status}`), { status, graphMessage: message });

beforeAll(() => {
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
});

beforeEach(() => {
  jest.clearAllMocks();
  // Implementations too - a test's refusal must not carry into the next.
  for (const fn of Object.values(directory)) fn.mockReset();
  process.env.ENTRA_STAFF_GROUP_ID = GROUP;
  directory.isConfigured.mockReturnValue(true);
  rows = {
    90: { id: 90, name: 'Ada Admin', email: 'admin@caa.co.ug', role: null, isSystemAdmin: true, active: true },
    91: { id: 91, name: 'Sam Second', email: 'sam@caa.co.ug', role: 'Manager', isSystemAdmin: true, active: true }
  };
  prisma.staffUser.findUnique.mockImplementation(async ({ where }) => {
    if (where.id) return rows[where.id] || null;
    return Object.values(rows).find((r) => (where.email && r.email === where.email) || (where.entraObjectId && r.entraObjectId === where.entraObjectId)) || null;
  });
  prisma.staffUser.findMany.mockImplementation(async ({ where }) => Object.values(rows).filter((r) => r.isSystemAdmin === where.isSystemAdmin && r.active === where.active));
  prisma.staffUser.create.mockImplementation(async ({ data }) => { rows[7] = account({ ...data, id: 7 }); return rows[7]; });
  prisma.staffUser.update.mockImplementation(async ({ where, data }) => { rows[where.id] = { ...rows[where.id], ...data }; return rows[where.id]; });
  prisma.staffUser.count.mockResolvedValue(2);
  prisma.department.findFirst.mockResolvedValue(null);
  prisma.auditLog.create.mockResolvedValue({});
  prisma.notification.create.mockResolvedValue({});
});

const createBody = (extra = {}) => ({ name: 'Grace Achieng', email: 'grace@caa.co.ug', role: 'HR_Officer', department: 'HR', entraObjectId: OID, ...extra });
const create = async (body = createBody()) => { const res = mockRes(); await controller.create({ user: admin, body }, res); return res; };
const adminNotices = () => prisma.notification.create.mock.calls.filter(([{ data }]) => data.taskType === 'StaffGroupSyncFailed' && data.channel === 'InApp');

describe('whether the staff app group is managed here', () => {
  test('needs both the group id and the directory connection', () => {
    expect(staffGroup.isConfigured()).toBe(true);
    process.env.ENTRA_STAFF_GROUP_ID = 'not-a-guid';
    expect(staffGroup.isConfigured()).toBe(false);
    process.env.ENTRA_STAFF_GROUP_ID = GROUP;
    directory.isConfigured.mockReturnValue(false);
    expect(staffGroup.isConfigured()).toBe(false);
  });
});

describe('creating an account', () => {
  test('a person typed in rather than picked from the directory is refused', async () => {
    const res = await create(createBody({ entraObjectId: null }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PICK_FROM_DIRECTORY' }));
    expect(prisma.staffUser.create).not.toHaveBeenCalled();
  });

  test('adds the person to the group, records it, and emails them to sign in', async () => {
    const res = await create();

    expect(directory.addGroupMember).toHaveBeenCalledWith(GROUP, OID);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].entraGroup).toEqual({ configured: true, state: 'InGroup', error: null });
    expect(rows[7].entraGroupState).toBe('InGroup');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'grace@caa.co.ug' }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'Added to staff app group' }) });
  });

  test('when Entra refuses, the account is still made, marked failed, the administrators told - and no sign-in email yet', async () => {
    directory.addGroupMember.mockRejectedValue(graphError(403));

    const res = await create();

    expect(res.status).toHaveBeenCalledWith(201);
    const { entraGroup } = res.json.mock.calls[0][0];
    expect(entraGroup.state).toBe('Failed');
    expect(entraGroup.error).toMatch(/administrative unit/);
    expect(rows[7]).toEqual(expect.objectContaining({ entraGroupState: 'Failed', entraGroupError: entraGroup.error }));
    expect(adminNotices().map(([{ data }]) => data.recipientId).sort()).toEqual([90, 91]);
    expect(adminNotices()[0][0].data.link).toBe('/hr/staff-accounts');
    expect(sendMail).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'grace@caa.co.ug' }));
  });

  test('without the group managed here, it is made and emailed as before, with no directory pick needed', async () => {
    delete process.env.ENTRA_STAFF_GROUP_ID;
    const res = await create(createBody({ entraObjectId: null }));

    expect(res.status).toHaveBeenCalledWith(201);
    expect(directory.addGroupMember).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'grace@caa.co.ug' }));
    expect(res.json.mock.calls[0][0].entraGroup.configured).toBe(false);
  });
});

describe('retrying after a failure', () => {
  beforeEach(() => {
    rows[7] = account({ entraGroupState: 'Failed', entraGroupError: 'Microsoft Entra could not be reached just now.' });
  });

  const retry = async () => { const res = mockRes(); await controller.retryEntraGroup({ user: admin, params: { id: '7' } }, res); return res; };

  test('getting them in at last clears the failure and sends the sign-in email they never got', async () => {
    const res = await retry();

    expect(res.json.mock.calls[0][0].entraGroup.state).toBe('InGroup');
    expect(rows[7]).toEqual(expect.objectContaining({ entraGroupState: 'InGroup', entraGroupError: null }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'grace@caa.co.ug' }));
    expect(adminNotices()).toHaveLength(0);
  });

  test('failing again keeps it failed without telling the administrators a second time', async () => {
    directory.addGroupMember.mockRejectedValue(new Error('network down'));

    const res = await retry();

    expect(res.json.mock.calls[0][0].entraGroup).toEqual(expect.objectContaining({ state: 'Failed', error: 'Microsoft Entra could not be reached just now.' }));
    expect(adminNotices()).toHaveLength(0);
  });

  test('is refused when the group is not managed here', async () => {
    delete process.env.ENTRA_STAFF_GROUP_ID;
    const res = await retry();
    expect(res.status).toHaveBeenCalledWith(501);
  });
});

describe('deactivating and reactivating', () => {
  const setActive = async (active) => {
    const res = mockRes();
    await controller.update({ user: admin, params: { id: '7' }, body: { active } }, res);
    return res;
  };

  test('deactivating takes them out of the group; reactivating puts them back', async () => {
    rows[7] = account({ entraGroupState: 'InGroup', lastLoginAt: new Date() });

    const off = await setActive(false);
    expect(directory.removeGroupMember).toHaveBeenCalledWith(GROUP, OID);
    expect(off.json.mock.calls[0][0].entraGroup.state).toBe('NotInGroup');

    const on = await setActive(true);
    expect(directory.addGroupMember).toHaveBeenCalledWith(GROUP, OID);
    expect(on.json.mock.calls[0][0].entraGroup.state).toBe('InGroup');
    // Someone who has signed in before isn't re-sent the welcome.
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('a role change leaves the group alone', async () => {
    rows[7] = account({ entraGroupState: 'InGroup' });
    const res = mockRes();
    await controller.update({ user: admin, params: { id: '7' }, body: { role: 'Manager' } }, res);
    expect(directory.addGroupMember).not.toHaveBeenCalled();
    expect(directory.removeGroupMember).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].entraGroup).toBeUndefined();
  });

  test('an account not linked yet is found in the directory by email', async () => {
    rows[7] = account({ entraObjectId: null, entraGroupState: 'InGroup' });
    directory.findUserIdByEmail.mockResolvedValue(OID);
    await setActive(false);
    expect(directory.findUserIdByEmail).toHaveBeenCalledWith('grace@caa.co.ug');
    expect(directory.removeGroupMember).toHaveBeenCalledWith(GROUP, OID);
  });

  test('someone missing from the directory is a failure the administrators hear about', async () => {
    rows[7] = account({ entraObjectId: null, entraGroupState: 'InGroup' });
    directory.findUserIdByEmail.mockResolvedValue(null);
    const res = await setActive(false);
    expect(res.json.mock.calls[0][0].entraGroup.error).toMatch(/not found in the UCAA directory/);
    expect(adminNotices()).toHaveLength(2);
  });
});

describe('the failure notice', () => {
  test('opens Staff accounts', async () => {
    expect(await linkFor('StaffGroupSyncFailed', 7)).toBe('/hr/staff-accounts');
  });
});

describe('bringing existing accounts into line (scripts/syncStaffGroup.js)', () => {
  const { run } = require('../scripts/syncStaffGroup');
  const OTHER = '99999999-8888-7777-6666-555555555555';
  const accounts = [
    account({ id: 7, entraGroupState: null }),
    account({ id: 8, name: 'Old Leaver', email: 'leaver@caa.co.ug', active: false, entraObjectId: OTHER, entraGroupState: null }),
    account({ id: 9, name: 'Already In', email: 'in@caa.co.ug', entraObjectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', entraGroupState: null })
  ];

  beforeEach(() => {
    for (const a of accounts) rows[a.id] = { ...a };
    prisma.staffUser.findMany.mockImplementation(async ({ where } = {}) => (where
      ? Object.values(rows).filter((r) => r.isSystemAdmin === where.isSystemAdmin && r.active === where.active)
      : accounts.map((a) => rows[a.id])));
    directory.groupMemberIds.mockResolvedValue(new Set([OTHER, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd']));
  });

  test('without --yes it only says what it would do', async () => {
    const { plan, strangers } = await run({ log: () => {} });
    expect(plan.add.map((a) => a.id)).toEqual([7]);
    expect(plan.remove.map((a) => a.id)).toEqual([8]);
    expect(plan.inLine.map((a) => a.id)).toEqual([9]);
    expect(strangers).toEqual(['dddddddd-dddd-dddd-dddd-dddddddddddd']);
    expect(directory.addGroupMember).not.toHaveBeenCalled();
    expect(prisma.staffUser.update).not.toHaveBeenCalled();
  });

  test('with --yes it adds, removes, and records those already right - leaving group members without accounts alone', async () => {
    await run({ apply: true, log: () => {} });
    expect(directory.addGroupMember).toHaveBeenCalledWith(GROUP, OID);
    expect(directory.removeGroupMember).toHaveBeenCalledWith(GROUP, OTHER);
    expect(directory.removeGroupMember).toHaveBeenCalledTimes(1);
    expect(rows[9].entraGroupState).toBe('InGroup');
    expect(rows[7].entraGroupState).toBe('InGroup');
    expect(rows[8].entraGroupState).toBe('NotInGroup');
  });
});
