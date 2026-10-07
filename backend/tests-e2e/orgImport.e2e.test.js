const request = require('supertest');
const { prisma, app, resetDatabase, createStaff, createOrg, staffToken, api, expectStatus } = require('./helpers');

// Batch import of the org structure (orgImportService.js), against the real
// schema: unique keys, the transaction and approve-all.

let staff;
let tokens;

beforeEach(async () => {
  await resetDatabase();
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    phro: await createStaff('Principal_HR_Officer', 'phro@caa.co.ug'),
    phro2: await createStaff('Principal_HR_Officer', 'phro2@caa.co.ug')
  };
  tokens = {};
  for (const [k, s] of Object.entries(staff)) tokens[k] = await staffToken(s.email);
  await createOrg(staff.hro.id); // Corporate Affairs -> Human Resources -> HR Analyst (Officer)
});

// fields: extra multipart fields, e.g. { autoApprove: 'false' } ("Approve now" unticked).
function upload(token, path, csv, name = 'org.csv', fields = {}) {
  let req = request(app).post(path).set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', Buffer.from(csv), { filename: name, contentType: 'text/csv' });
}
const usablePositions = async () => expectStatus(await api(tokens.hro).get('/api/positions'), 200).body.map((p) => p.name).sort();

const FILE = [
  'Directorate,Department,Position,Level',
  'Corporate Affairs,Human Resources,HR Analyst,Officer',
  'Corporate Affairs,Human Resources,Senior HR Officer,Senior',
  'Corporate Affairs,Payroll,Payroll Officer,Officer',
  'Corporate Affairs,Payroll,Payroll Manager,Manager',
  'DANS,AIM,AIS Officer,Officer'
].join('\n');

test('an HR Officer cannot add directorates through the import; nothing is imported while a row is wrong', async () => {
  const preview = expectStatus(await upload(tokens.hro, '/api/org-import/preview', FILE), 200).body;
  expect(preview.summary).toEqual(expect.objectContaining({ errors: 1, positions: 3, departments: 1 }));
  expect(preview.rows[4].messages[0]).toMatch(/Directorate "DANS" doesn't exist/);

  const refused = await upload(tokens.hro, '/api/org-import', FILE);
  expect(refused.status).toBe(422);
  expect(refused.body.code).toBe('IMPORT_HAS_ERRORS');
  expect(await prisma.position.count()).toBe(1);
  expect(await prisma.orgImport.count()).toBe(0);
});

test('"Approve now" unticked: everything new waits, out of the vacancy form, until another Principal HR Officer approves it all at once', async () => {
  const result = expectStatus(await upload(tokens.phro, '/api/org-import', FILE, 'UCAA organogram.csv', { autoApprove: 'false' }), 201).body;
  expect(result).toEqual(expect.objectContaining({ directorates: 1, departments: 2, positions: 4, skipped: 1, autoApproved: false }));

  const payroll = await prisma.department.findFirst({ where: { name: 'Payroll' }, include: { positions: true } });
  expect(payroll).toEqual(expect.objectContaining({ status: 'Pending', importId: result.importId }));
  expect(payroll.positions.map((p) => [p.name, p.level, p.status]).sort()).toEqual([['Payroll Manager', 4, 'Pending'], ['Payroll Officer', 1, 'Pending']]);
  expect(await prisma.directorate.findUnique({ where: { name: 'DANS' } })).toEqual(expect.objectContaining({ status: 'Pending', importId: result.importId }));

  // Not offered on the vacancy form until approved - not even the new
  // position in the already-approved Human Resources department.
  expect(await usablePositions()).toEqual(['HR Analyst']);

  // The pending list shows which import each department came from.
  const pending = expectStatus(await api(tokens.phro2).get('/api/departments/pending'), 200).body;
  expect(pending.map((d) => [d.name, d.import?.fileName])).toEqual([['Payroll', 'UCAA organogram.csv'], ['AIM', 'UCAA organogram.csv']]);
  expect(expectStatus(await api(tokens.phro2).get('/api/positions/pending'), 200).body).toHaveLength(4);

  // An HR Officer can't approve, nor can the importer; another Principal HR Officer approves it all at once.
  expect((await api(tokens.hro).patch(`/api/departments/imports/${result.importId}/approve`)).status).toBe(403);
  const own = await api(tokens.phro).patch(`/api/departments/imports/${result.importId}/approve`);
  expect([own.status, own.body.code]).toEqual([403, 'SELF_APPROVAL']);
  expect(expectStatus(await api(tokens.phro2).patch(`/api/departments/imports/${result.importId}/approve`), 200).body)
    .toEqual({ approved: 7, directorates: 1, departments: 2, positions: 4 });
  expect(await prisma.department.count({ where: { status: 'Pending' } })).toBe(0);
  expect(await prisma.position.count({ where: { status: 'Pending' } })).toBe(0);
  expect((await api(tokens.phro2).patch(`/api/departments/imports/${result.importId}/approve`)).status).toBe(422);

  expect(await usablePositions()).toEqual(['AIS Officer', 'HR Analyst', 'Payroll Manager', 'Payroll Officer', 'Senior HR Officer']);

  // Both steps are in the audit log, on the import.
  const log = await prisma.auditLog.findMany({ where: { entityType: 'OrgImport', entityId: result.importId }, orderBy: { id: 'asc' } });
  expect(log.map((r) => [r.action, r.performedById, r.payload.autoApproved ?? null])).toEqual([
    ['Imported, sent for approval', staff.phro.id, false],
    ['Approved import', staff.phro2.id, null]
  ]);

  // Importing the same file again adds nothing.
  const again = await upload(tokens.phro, '/api/org-import', FILE);
  expect(again.status).toBe(422);
  expect(again.body.error).toMatch(/already there/);
});

test('"Approve now" (the default for a Principal HR Officer): everything imported is approved and usable at once, and the audit log says so', async () => {
  const result = expectStatus(await upload(tokens.phro, '/api/org-import', FILE, 'UCAA organogram.csv'), 201).body;
  expect(result).toEqual(expect.objectContaining({ autoApproved: true, directorates: 1, departments: 2, positions: 4 }));
  expect(await prisma.department.count({ where: { status: 'Pending' } })).toBe(0);
  expect(await prisma.position.count({ where: { status: 'Pending' } })).toBe(0);
  expect(await usablePositions()).toEqual(['AIS Officer', 'HR Analyst', 'Payroll Manager', 'Payroll Officer', 'Senior HR Officer']);

  const [entry] = expectStatus(await api(tokens.hro).get('/api/audit/organisation'), 200).body;
  expect(entry).toEqual(expect.objectContaining({
    entityType: 'OrgImport', action: 'Imported and approved (Approve now)', autoApproved: true, name: 'UCAA organogram.csv',
    performedBy: expect.objectContaining({ id: staff.phro.id })
  }));
});

test('an HR Officer\'s import waits for approval', async () => {
  const file = 'Directorate,Department,Position,Level\nCorporate Affairs,Payroll,Payroll Officer,Officer';
  // autoApprove is ignored below Principal HR Officer.
  const result = expectStatus(await upload(tokens.hro, '/api/org-import', file, 'org.csv', { autoApprove: 'true' }), 201).body;
  expect(result.autoApproved).toBe(false);
  expect(await prisma.position.findFirst({ where: { name: 'Payroll Officer' } })).toEqual(expect.objectContaining({ status: 'Pending' }));
  expect(await usablePositions()).toEqual(['HR Analyst']);
});

test('one at a time: an HR Officer\'s position waits; a Principal HR Officer\'s is approved unless unticked; nobody approves their own', async () => {
  const dept = await prisma.department.findFirst({ where: { name: 'Human Resources' } });

  const byHro = expectStatus(await api(tokens.hro).post('/api/positions', { name: 'Records Officer', departmentId: dept.id, level: 'Officer', autoApprove: true }), 201).body;
  expect([byHro.status, byHro.autoApproved]).toEqual(['Pending', false]);
  const byPhro = expectStatus(await api(tokens.phro).post('/api/positions', { name: 'HR Manager', departmentId: dept.id, level: 'Manager' }), 201).body;
  expect([byPhro.status, byPhro.autoApproved]).toEqual(['Approved', true]);
  const unticked = expectStatus(await api(tokens.phro).post('/api/positions', { name: 'HR Director', departmentId: dept.id, level: 'Director', autoApprove: false }), 201).body;
  expect(unticked.status).toBe('Pending');
  expect(await usablePositions()).toEqual(['HR Analyst', 'HR Manager']);

  const own = await api(tokens.phro).patch(`/api/positions/${unticked.id}/approve`);
  expect([own.status, own.body.code]).toEqual([403, 'SELF_APPROVAL']);
  expectStatus(await api(tokens.phro2).patch(`/api/positions/${unticked.id}/approve`), 200);
  expectStatus(await api(tokens.phro).patch(`/api/positions/${byHro.id}/reject`, { reason: 'Not on the establishment' }), 200);
  expect(await usablePositions()).toEqual(['HR Analyst', 'HR Director', 'HR Manager']);

  // A vacancy can't be raised on a position that isn't approved.
  const refused = await api(tokens.hro).post('/api/vacancies', { positionId: byHro.id, postingType: 'External' });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toMatch(/not approved/);

  const actions = (await prisma.auditLog.findMany({ where: { entityType: 'Position' }, orderBy: { id: 'asc' } })).map((r) => [r.entityId, r.action]);
  expect(actions).toEqual([
    [byHro.id, 'Created, sent for approval'],
    [byPhro.id, 'Created and approved (Approve now)'],
    [unticked.id, 'Created, sent for approval'],
    [unticked.id, 'Approved'],
    [byHro.id, 'Rejected']
  ]);
});

test('directorates: approved at once by default, or sent to another Principal HR Officer; departments can\'t go under a rejected one', async () => {
  const now = expectStatus(await api(tokens.phro).post('/api/directorates', { name: 'DAAS' }), 201).body;
  expect(now.status).toBe('Approved');
  const later = expectStatus(await api(tokens.phro).post('/api/directorates', { name: 'DSSER', autoApprove: false }), 201).body;
  expect(later.status).toBe('Pending');
  expect(expectStatus(await api(tokens.phro2).get('/api/directorates/pending'), 200).body.map((d) => d.name)).toEqual(['DSSER']);

  expectStatus(await api(tokens.phro2).patch(`/api/directorates/${later.id}/reject`, { reason: 'Use DAAS' }), 200);
  expect((await api(tokens.hro).post('/api/departments', { name: 'Safety', directorateId: later.id })).status).toBe(400);

  // A department under the new directorate, by an HR Officer, waits.
  const dept = expectStatus(await api(tokens.hro).post('/api/departments', { name: 'Safety', directorateId: now.id }), 201).body;
  expect(dept.status).toBe('Pending');
});

test('the template downloads as a workbook, and positions are created with level words', async () => {
  const res = await api(tokens.hro).get('/api/org-import/template').buffer(true).parse((r, cb) => {
    const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  expect(res.body.slice(0, 2).toString()).toBe('PK'); // a zip, as .xlsx files are

  const dept = await prisma.department.findFirst({ where: { name: 'Human Resources' } });
  const created = expectStatus(await api(tokens.hro).post('/api/positions', { name: 'Principal HR Officer', departmentId: dept.id, level: 'Principal' }), 201).body;
  expect([created.level, created.status]).toEqual([3, 'Pending']);
  expect((await api(tokens.hro).post('/api/positions', { name: 'X', departmentId: dept.id, level: 'Chief' })).body.error)
    .toBe('Level must be one of: Officer, Senior, Principal, Manager, Director');
});
