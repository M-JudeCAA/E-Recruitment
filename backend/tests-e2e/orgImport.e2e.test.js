const request = require('supertest');
const { prisma, app, resetDatabase, createStaff, createOrg, staffToken, api, expectStatus } = require('./helpers');

// Batch import of the org structure (orgImportService.js), against the real
// schema: unique keys, the transaction and approve-all; and managing the
// structure afterwards (orgAdminService.js).

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
  await createOrg(staff.hro.id); // CA Corporate Affairs -> HR Human Resources -> HRA HR Analyst (Officer)
});

// fields: extra multipart fields, e.g. { autoApprove: 'false' } ("Approve now" unticked).
function upload(token, path, csv, name = 'org.csv', fields = {}) {
  let req = request(app).post(path).set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', Buffer.from(csv), { filename: name, contentType: 'text/csv' });
}
const usablePositions = async () => expectStatus(await api(tokens.hro).get('/api/positions'), 200).body.map((p) => p.name).sort();

const HEAD = 'Directorate code,Directorate name,Department code,Department name,Position code,Position,Level';
const FILE = [
  HEAD,
  'CA,,HR,,HRA,HR Analyst,Officer',
  'CA,,HR,,SHRO,Senior HR Officer,Senior',
  'CA,,PAY,Payroll,PO,Payroll Officer,Officer',
  'CA,,PAY,,PM,Payroll Manager,Manager',
  'DANS,Air Navigation Services,AIM,Aeronautical Information Management,AISO,AIS Officer,Officer'
].join('\n');

test('an HR Officer cannot add directorates through the import; nothing is imported while a row is wrong', async () => {
  const preview = expectStatus(await upload(tokens.hro, '/api/org-import/preview', FILE), 200).body;
  expect(preview.summary).toEqual(expect.objectContaining({ errors: 1, positions: 3, departments: 1 }));
  expect(preview.rows[4].messages[0]).toMatch(/Directorate DANS doesn't exist/);

  const refused = await upload(tokens.hro, '/api/org-import', FILE);
  expect(refused.status).toBe(422);
  expect(refused.body.code).toBe('IMPORT_HAS_ERRORS');
  expect(await prisma.position.count()).toBe(1);
  expect(await prisma.orgImport.count()).toBe(0);
});

test('"Approve now" unticked: everything new waits, out of the vacancy form, until another Principal HR Officer approves it all at once', async () => {
  const result = expectStatus(await upload(tokens.phro, '/api/org-import', FILE, 'UCAA organogram.csv', { autoApprove: 'false' }), 201).body;
  expect(result).toEqual(expect.objectContaining({ directorates: 1, departments: 2, positions: 4, skipped: 1, autoApproved: false }));

  const payroll = await prisma.department.findFirst({ where: { code: 'PAY' }, include: { positions: true } });
  expect(payroll).toEqual(expect.objectContaining({ name: 'Payroll', status: 'Pending', importId: result.importId }));
  expect(payroll.positions.map((p) => [p.code, p.name, p.level, p.status]).sort()).toEqual([
    ['PM', 'Payroll Manager', 4, 'Pending'], ['PO', 'Payroll Officer', 1, 'Pending']
  ]);
  expect(await prisma.directorate.findUnique({ where: { code: 'DANS' } }))
    .toEqual(expect.objectContaining({ name: 'Air Navigation Services', status: 'Pending', importId: result.importId }));

  // Not offered on the vacancy form until approved - not even the new
  // position in the already-approved Human Resources department.
  expect(await usablePositions()).toEqual(['HR Analyst']);

  // The pending list shows which import each department came from.
  const pending = expectStatus(await api(tokens.phro2).get('/api/departments/pending'), 200).body;
  expect(pending.map((d) => [d.code, d.import?.fileName]).sort()).toEqual([['AIM', 'UCAA organogram.csv'], ['PAY', 'UCAA organogram.csv']]);
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
  const file = `${HEAD}\nCA,,PAY,Payroll,PO,Payroll Officer,Officer`;
  // autoApprove is ignored below Principal HR Officer.
  const result = expectStatus(await upload(tokens.hro, '/api/org-import', file, 'org.csv', { autoApprove: 'true' }), 201).body;
  expect(result.autoApproved).toBe(false);
  expect(await prisma.position.findFirst({ where: { name: 'Payroll Officer' } })).toEqual(expect.objectContaining({ code: 'PO', status: 'Pending' }));
  expect(await usablePositions()).toEqual(['HR Analyst']);
});

test('one at a time: an HR Officer\'s position waits; a Principal HR Officer\'s is approved unless unticked; nobody approves their own', async () => {
  const dept = await prisma.department.findFirst({ where: { code: 'HR' } });

  const byHro = expectStatus(await api(tokens.hro).post('/api/positions', { code: 'RO', name: 'Records Officer', departmentId: dept.id, level: 'Officer', autoApprove: true }), 201).body;
  expect([byHro.status, byHro.autoApproved]).toEqual(['Pending', false]);
  const byPhro = expectStatus(await api(tokens.phro).post('/api/positions', { code: 'MHR', name: 'HR Manager', departmentId: dept.id, level: 'Manager' }), 201).body;
  expect([byPhro.status, byPhro.autoApproved]).toEqual(['Approved', true]);
  const unticked = expectStatus(await api(tokens.phro).post('/api/positions', { code: 'DHR', name: 'HR Director', departmentId: dept.id, level: 'Director', autoApprove: false }), 201).body;
  expect(unticked.status).toBe('Pending');
  expect(await usablePositions()).toEqual(['HR Analyst', 'HR Manager']);

  // Codes are unique within the department.
  expect((await api(tokens.phro).post('/api/positions', { code: 'mhr', name: 'Another Manager', departmentId: dept.id, level: 'Manager' })).status).toBe(409);

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
  const now = expectStatus(await api(tokens.phro).post('/api/directorates', { code: 'DAAS', name: 'Airports and Aviation Security' }), 201).body;
  expect(now.status).toBe('Approved');
  const later = expectStatus(await api(tokens.phro).post('/api/directorates', { code: 'DSSER', name: 'Safety, Security and Economic Regulation', autoApprove: false }), 201).body;
  expect(later.status).toBe('Pending');
  expect(expectStatus(await api(tokens.phro2).get('/api/directorates/pending'), 200).body.map((d) => d.code)).toEqual(['DSSER']);
  expect((await api(tokens.phro).post('/api/directorates', { code: 'daas', name: 'Something else' })).status).toBe(409);

  expectStatus(await api(tokens.phro2).patch(`/api/directorates/${later.id}/reject`, { reason: 'Use DAAS' }), 200);
  expect((await api(tokens.hro).post('/api/departments', { code: 'SAF', name: 'Safety', directorateId: later.id })).status).toBe(400);

  // A department under the new directorate, by an HR Officer, waits.
  const dept = expectStatus(await api(tokens.hro).post('/api/departments', { code: 'SAF', name: 'Safety', directorateId: now.id }), 201).body;
  expect(dept.status).toBe('Pending');
});

test('managing the structure: lists with counts, editing, moving and deleting what nothing uses, all audited', async () => {
  const ca = await prisma.directorate.findUnique({ where: { code: 'CA' } });
  const hr = await prisma.department.findFirst({ where: { code: 'HR' } });
  const analyst = await prisma.position.findFirst({ where: { code: 'HRA' } });

  // Anyone in HR sees every directorate, department and position with what each holds.
  const directorates = expectStatus(await api(tokens.hro).get('/api/directorates'), 200).body;
  expect(directorates).toEqual([expect.objectContaining({ code: 'CA', departmentCount: 1, positionCount: 1 })]);
  const departments = expectStatus(await api(tokens.hro).get('/api/departments/admin'), 200).body;
  expect(departments).toEqual([expect.objectContaining({ code: 'HR', positionCount: 1, vacancyCount: 0, staffCount: 0, directorate: expect.objectContaining({ code: 'CA' }) })]);
  const positions = expectStatus(await api(tokens.hro).get('/api/positions/admin'), 200).body;
  expect(positions).toEqual([expect.objectContaining({ code: 'HRA', vacancyCount: 0, department: expect.objectContaining({ code: 'HR' }) })]);

  // An HR Officer can't change an approved department; a Principal HR Officer can, and it is audited.
  expect((await api(tokens.hro).patch(`/api/departments/${hr.id}`, { name: 'People' })).status).toBe(403);
  const renamed = expectStatus(await api(tokens.phro).patch(`/api/departments/${hr.id}`, { code: 'hrm', name: 'Human Resource Management' }), 200).body;
  expect([renamed.code, renamed.name]).toEqual(['HRM', 'Human Resource Management']);
  const history = expectStatus(await api(tokens.hro).get(`/api/audit/Department/${hr.id}`), 200).body;
  expect(history[0]).toEqual(expect.objectContaining({ action: 'Edited', changes: { code: { from: 'HR', to: 'HRM' }, name: { from: 'Human Resources', to: 'Human Resource Management' } } }));

  // Moved to another directorate, where its code must be free.
  const other = expectStatus(await api(tokens.phro).post('/api/directorates', { code: 'DF', name: 'Finance' }), 201).body;
  expectStatus(await api(tokens.phro).post('/api/departments', { code: 'HRM', name: 'HR in Finance', directorateId: other.id }), 201);
  expect((await api(tokens.phro).patch(`/api/departments/${hr.id}`, { directorateId: other.id })).status).toBe(409);

  // Deleting: refused while anything uses it.
  const inUse = await api(tokens.phro).delete(`/api/directorates/${ca.id}`);
  expect([inUse.status, inUse.body.code]).toEqual([409, 'ORG_IN_USE']);
  expect((await api(tokens.phro).delete(`/api/departments/${hr.id}`)).status).toBe(409);

  // Whoever added a pending position may correct or withdraw it; others below PHRO may not.
  const pending = expectStatus(await api(tokens.hro).post('/api/positions', { code: 'RC', name: 'Records Clerk', departmentId: hr.id, level: 'Officer' }), 201).body;
  expectStatus(await api(tokens.hro).patch(`/api/positions/${pending.id}`, { name: 'Records Assistant', level: 'Senior' }), 200);
  expectStatus(await api(tokens.hro).delete(`/api/positions/${pending.id}`).send({ reason: 'Not needed' }), 200);
  expect(await prisma.position.findUnique({ where: { id: pending.id } })).toBeNull();
  const withdrawn = await prisma.auditLog.findFirst({ where: { entityType: 'Position', entityId: pending.id }, orderBy: { id: 'desc' } });
  expect([withdrawn.action, withdrawn.payload.comment]).toEqual(['Withdrawn', 'Not needed']);

  // Unused: deleted, position then department.
  expectStatus(await api(tokens.phro).delete(`/api/positions/${analyst.id}`), 200);
  expectStatus(await api(tokens.phro).delete(`/api/departments/${hr.id}`), 200);
  expectStatus(await api(tokens.phro).delete(`/api/directorates/${ca.id}`), 200);
  expect(await prisma.directorate.count()).toBe(1);
  const recent = expectStatus(await api(tokens.hro).get('/api/audit/organisation'), 200).body;
  expect(recent[0]).toEqual(expect.objectContaining({ entityType: 'Directorate', action: 'Deleted', code: 'CA', name: 'Corporate Affairs' }));
});

test('the template downloads as a workbook, and positions are created with level words', async () => {
  const res = await api(tokens.hro).get('/api/org-import/template').buffer(true).parse((r, cb) => {
    const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  expect(res.body.slice(0, 2).toString()).toBe('PK'); // a zip, as .xlsx files are

  const dept = await prisma.department.findFirst({ where: { code: 'HR' } });
  const created = expectStatus(await api(tokens.hro).post('/api/positions', { code: 'PHRO', name: 'Principal HR Officer', departmentId: dept.id, level: 'Principal' }), 201).body;
  expect([created.level, created.status]).toEqual([3, 'Pending']);
  expect((await api(tokens.hro).post('/api/positions', { code: 'X', name: 'X', departmentId: dept.id, level: 'Chief' })).body.error)
    .toBe('Level must be one of: Officer, Senior, Principal, Manager, Director');
});
