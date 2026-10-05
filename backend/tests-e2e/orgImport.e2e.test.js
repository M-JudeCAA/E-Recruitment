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
    phro: await createStaff('Principal_HR_Officer', 'phro@caa.co.ug')
  };
  tokens = {};
  for (const [k, s] of Object.entries(staff)) tokens[k] = await staffToken(s.email);
  await createOrg(staff.hro.id); // Corporate Affairs -> Human Resources -> HR Analyst (Officer)
});

function upload(token, path, csv, name = 'org.csv') {
  return request(app).post(path).set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(csv), { filename: name, contentType: 'text/csv' });
}

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

test('imports, keeps new departments pending with their positions out of the vacancy form, and approves them all at once', async () => {
  const result = expectStatus(await upload(tokens.phro, '/api/org-import', FILE, 'UCAA organogram.csv'), 201).body;
  expect(result).toEqual(expect.objectContaining({ directorates: 1, departments: 2, positions: 4, skipped: 1 }));

  const payroll = await prisma.department.findFirst({ where: { name: 'Payroll' }, include: { positions: true } });
  expect(payroll).toEqual(expect.objectContaining({ status: 'Pending', importId: result.importId }));
  expect(payroll.positions.map((p) => [p.name, p.level]).sort()).toEqual([['Payroll Manager', 4], ['Payroll Officer', 1]]);

  // Not offered on the vacancy form until the department is approved.
  const before = expectStatus(await api(tokens.hro).get('/api/positions'), 200).body.map((p) => p.name).sort();
  expect(before).toEqual(['HR Analyst', 'Senior HR Officer']);

  // The pending list shows which import each department came from.
  const pending = expectStatus(await api(tokens.phro).get('/api/departments/pending'), 200).body;
  expect(pending.map((d) => [d.name, d.import?.fileName])).toEqual([['Payroll', 'UCAA organogram.csv'], ['AIM', 'UCAA organogram.csv']]);

  // An HR Officer can't approve; a Principal HR Officer approves both at once.
  expect((await api(tokens.hro).patch(`/api/departments/imports/${result.importId}/approve`)).status).toBe(403);
  expect(expectStatus(await api(tokens.phro).patch(`/api/departments/imports/${result.importId}/approve`), 200).body).toEqual({ approved: 2 });
  expect(await prisma.department.count({ where: { status: 'Pending' } })).toBe(0);
  expect((await api(tokens.phro).patch(`/api/departments/imports/${result.importId}/approve`)).status).toBe(422);

  const after = expectStatus(await api(tokens.hro).get('/api/positions'), 200).body;
  expect(after.map((p) => p.name).sort()).toEqual(['AIS Officer', 'HR Analyst', 'Payroll Manager', 'Payroll Officer', 'Senior HR Officer']);

  // Importing the same file again adds nothing.
  const again = await upload(tokens.phro, '/api/org-import', FILE);
  expect(again.status).toBe(422);
  expect(again.body.error).toMatch(/already there/);
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
  expect(created.level).toBe(3);
  expect((await api(tokens.hro).post('/api/positions', { name: 'X', departmentId: dept.id, level: 'Chief' })).body.error)
    .toBe('Level must be one of: Officer, Senior, Principal, Manager, Director');
});
