const request = require('supertest');
const app = require('../src/app');
const { prisma, resetDatabase, createStaff, createOrg, staffToken, api, expectStatus } = require('./helpers');

// The system administrator's audit log against the real schema: every
// change request is in the activity log with who, the IP address and the
// browser; every audit row it writes carries the same request (the Prisma
// extension in config/db.js and the request context) - through a file
// upload too; and only a system administrator can read it.

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

let hro;
let admin;
let tokens;

beforeEach(async () => {
  await resetDatabase();
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
  hro = await createStaff('HR_Officer', 'hro@caa.co.ug');
  admin = await prisma.staffUser.create({ data: { name: 'Sam Admin', email: 'admin@caa.co.ug', passwordHash: hro.passwordHash, role: null, isSystemAdmin: true, department: 'IT' } });
  await createOrg(hro.id);
  tokens = { hro: await staffToken(hro.email), admin: await staffToken(admin.email) };
});

// The activity row is written once the response has gone.
async function activityFor(where) {
  for (let i = 0; i < 20; i++) {
    const row = await prisma.activityLog.findFirst({ where, orderBy: { id: 'desc' } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

test('a refused sign-in is recorded with the email tried, the address and the browser - never the password', async () => {
  const res = await request(app).post('/api/staff/auth/login').set('User-Agent', BROWSER).send({ email: 'hro@caa.co.ug', password: 'wrong-password-123' });
  expect(res.status).toBe(401);
  const row = await activityFor({ route: '/api/staff/auth/login', outcome: 'refused' });
  expect(row).toEqual(expect.objectContaining({
    actorType: 'anonymous', action: 'Staff sign-in (password)', statusCode: 401, userAgent: BROWSER, detail: { email: 'hro@caa.co.ug' }
  }));
  expect(row.ipAddress).toBeTruthy();
  expect(JSON.stringify(row)).not.toContain('wrong-password-123');

  const signedIn = await activityFor({ route: '/api/staff/auth/login', outcome: 'success', staffUserId: hro.id });
  expect(signedIn).toEqual(expect.objectContaining({ actorType: 'staff', actorLabel: hro.name }));
});

test('a change: the activity row and its audit row share the request, who and where', async () => {
  const directorate = await prisma.directorate.findFirst();
  const created = expectStatus(await api(tokens.hro).post('/api/departments', { code: 'PAY', name: 'Payroll', directorateId: directorate.id, autoApprove: false }).set('User-Agent', BROWSER), 201).body;

  const activity = await activityFor({ route: '/api/departments', staffUserId: hro.id });
  expect(activity).toEqual(expect.objectContaining({ action: 'Department added', outcome: 'success', actorType: 'staff', userAgent: BROWSER }));

  const auditRow = await prisma.auditLog.findFirst({ where: { entityType: 'Department', entityId: created.id } });
  expect(auditRow).toEqual(expect.objectContaining({
    actorType: 'staff', actorLabel: hro.name, userAgent: BROWSER, requestMethod: 'POST', requestPath: '/api/departments',
    requestId: activity.requestId, ipAddress: activity.ipAddress
  }));
});

test('a file upload keeps the request for what it audits', async () => {
  const csv = 'Directorate code,Directorate name,Department code,Department name,Position code,Position,Level\nCA,Corporate Affairs,HR,Human Resources,HRO,HR Officer,Officer\n';
  expectStatus(await request(app).post('/api/org-import').set('Authorization', `Bearer ${tokens.hro}`).set('User-Agent', BROWSER)
    .attach('file', Buffer.from(csv), { filename: 'org.csv', contentType: 'text/csv' }), 201);

  const auditRow = await prisma.auditLog.findFirst({ where: { entityType: 'OrgImport' } });
  const activity = await activityFor({ route: '/api/org-import' });
  expect(auditRow.requestId).toBeTruthy();
  expect(auditRow).toEqual(expect.objectContaining({ actorType: 'staff', userAgent: BROWSER, requestId: activity.requestId }));
});

test('only a system administrator reads the audit log; exports are audited', async () => {
  await request(app).post('/api/staff/auth/login').send({ email: 'nobody@caa.co.ug', password: 'x' });
  await activityFor({ outcome: 'refused' });

  expect((await api(tokens.hro).get('/api/admin/audit/activity')).status).toBe(403);
  const list = expectStatus(await api(tokens.admin).get('/api/admin/audit/activity?signIns=true&outcome=refused'), 200).body;
  expect(list.rows.map((r) => r.detail?.email)).toContain('nobody@caa.co.ug');

  const changes = expectStatus(await api(tokens.admin).get('/api/admin/audit/changes'), 200).body;
  expect(changes.total).toBeGreaterThanOrEqual(0);
  expect(expectStatus(await api(tokens.admin).get('/api/admin/audit/meta'), 200).body.staff.map((s) => s.email)).toContain('hro@caa.co.ug');

  const csv = await api(tokens.admin).get('/api/admin/audit/activity/export');
  expect(csv.status).toBe(200);
  expect(csv.headers['content-type']).toMatch(/text\/csv/);
  expect(await prisma.auditLog.count({ where: { entityType: 'AuditLog', action: 'Exported the activity log', performedById: admin.id } })).toBe(1);
  await prisma.$disconnect();
});
