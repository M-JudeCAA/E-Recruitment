const { prisma, resetDatabase, createStaff, staffToken, api, expectStatus } = require('./helpers');

// An HR Manager manages the HR roles of the HR department's staff, below
// their own rank; a Manager outside HR can't; a system administrator moves
// accounts between HR and ICT.

let staff;
let tokens;

beforeEach(async () => {
  await resetDatabase();
  staff = {
    manager: await createStaff('Manager', 'manager@caa.co.ug'),
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    director: await createStaff('Director', 'dhra@caa.co.ug'),
    ictManager: await createStaff('Manager', 'ict.manager@caa.co.ug')
  };
  await prisma.staffUser.update({ where: { id: staff.ictManager.id }, data: { department: 'ICT' } });
  staff.admin = await prisma.staffUser.create({ data: { name: 'Sam Admin', email: 'admin@caa.co.ug', passwordHash: staff.hro.passwordHash, role: null, isSystemAdmin: true, department: 'ICT' } });
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
});

test('an HR Manager sees the HR department and changes a role below their own', async () => {
  const team = expectStatus(await api(tokens.manager).get('/api/staff-users/hr-team'), 200).body;
  expect(team.accounts.map((a) => a.email).sort()).toEqual(['dhra@caa.co.ug', 'hro@caa.co.ug', 'manager@caa.co.ug']);
  expect(team.assignableRoles).toEqual(['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer']);

  expectStatus(await api(tokens.manager).patch(`/api/staff-users/hr-team/${staff.hro.id}/role`, { role: 'Senior_HR_Officer', comment: 'Promoted' }), 200);
  expect((await prisma.staffUser.findUnique({ where: { id: staff.hro.id } })).role).toBe('Senior_HR_Officer');
  expect(await prisma.auditLog.count({ where: { entityType: 'StaffUser', entityId: staff.hro.id, action: 'HR role changed by HR Manager' } })).toBe(1);

  // Not up to their own rank, not the Director, not someone in ICT, and no new accounts.
  expect((await api(tokens.manager).patch(`/api/staff-users/hr-team/${staff.hro.id}/role`, { role: 'Manager' })).status).toBe(403);
  expect((await api(tokens.manager).patch(`/api/staff-users/hr-team/${staff.director.id}/role`, { role: 'HR_Officer' })).status).toBe(403);
  expect((await api(tokens.manager).patch(`/api/staff-users/hr-team/${staff.ictManager.id}/role`, { role: 'HR_Officer' })).status).toBe(404);
  expect((await api(tokens.manager).post('/api/staff-users', { name: 'New', email: 'new@caa.co.ug', role: 'HR_Officer' })).status).toBe(403);
});

test('a Manager outside HR has no HR team', async () => {
  expect((await api(tokens.ictManager).get('/api/staff-users/hr-team')).status).toBe(403);
});

test('a system administrator moves an account between HR and ICT, and nothing else', async () => {
  expectStatus(await api(tokens.admin).patch(`/api/staff-users/${staff.hro.id}`, { department: 'ICT' }), 200);
  expect((await prisma.staffUser.findUnique({ where: { id: staff.hro.id } })).department).toBe('ICT');
  expect((await api(tokens.admin).patch(`/api/staff-users/${staff.hro.id}`, { department: 'Finance' })).status).toBe(400);
  // Now outside HR, the Manager no longer sees them.
  const team = expectStatus(await api(tokens.manager).get('/api/staff-users/hr-team'), 200).body;
  expect(team.accounts.map((a) => a.email)).not.toContain('hro@caa.co.ug');
  await prisma.$disconnect();
});
