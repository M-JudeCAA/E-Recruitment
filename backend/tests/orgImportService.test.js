jest.mock('../src/config/db', () => require('./__mocks__/db'));
const ExcelJS = require('exceljs');
const prisma = require('../src/config/db');
const orgImport = require('../src/services/orgImportService');
const { levelFromInput, levelLabel } = require('../src/utils/positionLevels');

const csvFile = (text, name = 'org.csv') => ({ originalname: name, buffer: Buffer.from(text, 'utf8') });

async function xlsxFile(rows, name = 'org.xlsx') {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Org structure');
  rows.forEach((r) => sheet.addRow(r));
  return { originalname: name, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

const HEAD = 'Directorate code,Directorate name,Department code,Department name,Position code,Position,Level';
const DIRECTORATES = [
  { id: 1, code: 'DHRA', name: 'Human Resource and Administration', status: 'Approved' },
  { id: 2, code: 'DF', name: 'Finance', status: 'Approved' }
];
const DEPARTMENTS = [
  { id: 10, code: 'HR', name: 'Human Resource', directorateId: 1, status: 'Approved' },
  { id: 11, code: 'LD', name: 'Learning and Development', directorateId: 1, status: 'Pending' },
  { id: 12, code: 'PAY', name: 'Payroll', directorateId: 2, status: 'Rejected', rejectionReason: 'Merged into FINANCE' }
];
const POSITIONS = [{ id: 100, code: 'HRA', name: 'HR Analyst', departmentId: 10, level: 1, status: 'Approved' }];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.directorate.findMany.mockResolvedValue(DIRECTORATES);
  prisma.department.findMany.mockResolvedValue(DEPARTMENTS);
  prisma.position.findMany.mockResolvedValue(POSITIONS);
});

describe('position levels', () => {
  test('words in any case, or their numbers; anything else is refused', () => {
    expect(['Officer', ' senior ', 'PRINCIPAL', 'Manager', 'director'].map(levelFromInput)).toEqual([1, 2, 3, 4, 5]);
    expect(levelFromInput(3)).toBe(3);
    expect(levelFromInput('3')).toBe(3);
    for (const bad of ['Assistant', '', null, 0, 6, '2.5', 'Senior Officer']) expect(levelFromInput(bad)).toBeNull();
    expect(levelLabel(4)).toBe('Manager');
  });
});

describe('reading the file', () => {
  test('CSV with quoted fields, a byte-order mark, CRLF line ends and blank rows; codes upper-cased', async () => {
    const rows = await orgImport.readFile(csvFile(`﻿${HEAD}\r\ndhra,Human Resource and Administration,hr,Human Resource,hro,"Officer, Recruitment",Officer\r\n,,,,,,\r\nDF,Finance,FIN,"Finance ""A""",,,\r\n`));
    expect(rows).toEqual([
      { rowNumber: 2, directorate: 'DHRA', directorateName: 'Human Resource and Administration', department: 'HR', departmentName: 'Human Resource', positionCode: 'HRO', position: 'Officer, Recruitment', level: 'Officer' },
      { rowNumber: 4, directorate: 'DF', directorateName: 'Finance', department: 'FIN', departmentName: 'Finance "A"', positionCode: '', position: '', level: '' }
    ]);
  });

  test('Excel, with headings in any order and other columns ignored; older Directorate/Department headings are the codes', async () => {
    const file = await xlsxFile([['Level', 'Notes', 'Position', 'Department', 'Directorate'], ['Senior', 'x', 'Senior HR Officer', 'HR', 'DHRA']]);
    expect(await orgImport.readFile(file)).toEqual([
      { rowNumber: 2, directorate: 'DHRA', directorateName: '', department: 'HR', departmentName: '', positionCode: '', position: 'Senior HR Officer', level: 'Senior' }
    ]);
  });

  test('refuses other file types, missing headings and empty files', async () => {
    await expect(orgImport.readFile(csvFile('x', 'org.pdf'))).rejects.toMatchObject({ status: 400 });
    await expect(orgImport.readFile(csvFile('Name,Level\nHR,Officer\n'))).rejects.toThrow(/missing directorate code and department code/);
    await expect(orgImport.readFile(csvFile(`${HEAD}\n`))).rejects.toThrow(/no rows/);
    await expect(orgImport.readFile({ originalname: 'org.xlsx', buffer: Buffer.from('not a workbook') })).rejects.toThrow(/could not be read/);
  });
});

describe('checking the rows', () => {
  const run = async (lines, options = { canAddDirectorates: false }) => orgImport.plan(await orgImport.readFile(csvFile([HEAD, ...lines].join('\n'))), options);

  test('new positions, departments and what already exists; names are needed once per new item', async () => {
    const result = await run([
      'DHRA,,HR,,HRA,HR Analyst,Officer', // exists
      'DHRA,,hr,,SHRO,Senior HR Officer,senior', // new position, department matched by code case-insensitively
      'DHRA,,ADMIN,Administration,OA,Office Administrator,Officer', // new department and position
      'DHRA,,ADMIN,,,,', // department already being added
      'DHRA,,LD,,TO,Training Officer,Officer' // pending department
    ]);

    expect(result.rows.map((r) => [r.status, r.creates.join('+'), r.messages.join('; ')])).toEqual([
      ['exists', '', 'Position already exists'],
      ['new', 'position', ''],
      ['new', 'department+position', ''],
      ['exists', '', ''],
      ['new', 'position', 'Department is awaiting approval']
    ]);
    expect(result.summary).toEqual(expect.objectContaining({ errors: 0, directorates: 0, departments: 1, positions: 3, skipped: 2 }));
    expect(result.toCreate.departments).toEqual([{ directorate: 'DHRA', code: 'ADMIN', name: 'Administration', rowNumber: 4 }]);
    expect(result.toCreate.positions[0]).toEqual(expect.objectContaining({ directorate: 'DHRA', department: 'HR', code: 'SHRO', name: 'Senior HR Officer', level: 2 }));
  });

  test('errors that must be fixed first', async () => {
    const result = await run([
      'DANS,Air Navigation Services,AIM,Aeronautical Information Management,AISO,AIS Officer,Officer', // unknown directorate, not allowed to add
      'DHRA,,HR,,RC,Records Clerk,Assistant', // not a level
      'DHRA,,HR,,RO,Records Officer,', // level missing
      'DHRA,,HR,,,,Senior', // level without position
      'DF,,PAY,,PO,Payroll Officer,Officer', // rejected department
      'DHRA,,HR,,TL,Talent Lead,Senior',
      'DHRA,,HR,,TL,Talent Lead,Manager', // same position, different level
      ',,HR,,X,X,Officer', // no directorate code
      'DHRA,,ADMIN,,OA,Office Administrator,Officer', // new department without its name
      'DHRA,,HR,,,Records Assistant,Officer', // new position without a code
      'DHRA,,HR,,HRA,Recruitment Officer,Officer', // code HRA belongs to HR Analyst
      'DHRA,,HR,,TL,Team Lead,Officer', // code TL given to Talent Lead earlier in the file
      'DHRA,,H*R,,X,X,Officer', // a code with other characters
      'DHRA,,PERS,Human Resource,X,X,Officer' // a department called Human Resource exists with code HR
    ]);

    const errors = result.rows.map((r) => (r.status === 'error' ? r.messages[0] : null));
    expect(errors[0]).toMatch(/Directorate DANS doesn't exist\. Only a Principal HR Officer/);
    expect(errors[1]).toMatch(/"Assistant" isn't a level - use one of Officer, Senior, Principal, Manager, Director/);
    expect(errors[2]).toMatch(/Level is missing/);
    expect(errors[3]).toMatch(/Position is empty but a position code or level is given/);
    expect(errors[4]).toMatch(/Department PAY under DF was rejected \(Merged into FINANCE\)/);
    expect(errors[5]).toBeNull();
    expect(errors[6]).toMatch(/Row 7 has the same position as Senior/);
    expect(errors[7]).toMatch(/Directorate code is missing/);
    expect(errors[8]).toMatch(/Department ADMIN is new - give its full name/);
    expect(errors[9]).toMatch(/Position code is missing/);
    expect(errors[10]).toMatch(/The code HRA is already used by "HR Analyst"/);
    expect(errors[11]).toMatch(/The code TL is also given to "Talent Lead"/);
    expect(errors[12]).toMatch(/short code can only have/);
    expect(errors[13]).toMatch(/Department "Human Resource" already exists under DHRA with the code HR/);
    expect(result.summary.errors).toBe(13);
  });

  test('rejected directorates and positions can\'t be imported again; pending ones are noted; a different name is a warning', async () => {
    prisma.directorate.findMany.mockResolvedValue([...DIRECTORATES,
      { id: 3, code: 'DOLD', name: 'Old', status: 'Rejected', rejectionReason: 'Abolished' },
      { id: 4, code: 'DNEW', name: 'New', status: 'Pending' }]);
    prisma.position.findMany.mockResolvedValue([...POSITIONS,
      { id: 101, code: 'CLK', name: 'Clerk', departmentId: 10, level: 1, status: 'Rejected', rejectionReason: 'Not on the establishment' },
      { id: 102, code: null, name: 'Coach', departmentId: 10, level: 1, status: 'Pending' }]);
    const result = await run([
      'DOLD,,X,X,,,',
      'DHRA,,HR,,CLK,Clerk,Officer',
      'DHRA,,HR,,,Coach,Officer',
      'DNEW,,Y,Yard,,,',
      'DHRA,Human Resources Directorate,HR,,,,',
      'DHRA,,HR,,COA,Coach,Officer'
    ]);
    expect(result.rows[0].messages[0]).toMatch(/Directorate DOLD was rejected \(Abolished\)/);
    expect(result.rows[1].messages[0]).toMatch(/Position "Clerk" was rejected \(Not on the establishment\)/);
    expect(result.rows[2].messages).toEqual(['Position is awaiting approval', 'Position already exists']);
    expect(result.rows[3]).toEqual(expect.objectContaining({ status: 'new', messages: ['Directorate is awaiting approval'] }));
    expect(result.rows[4]).toEqual(expect.objectContaining({ status: 'warning', messages: [expect.stringMatching(/DHRA is "Human Resource and Administration" in the system/)] }));
    expect(result.rows[5]).toEqual(expect.objectContaining({ status: 'warning', messages: expect.arrayContaining([expect.stringMatching(/without a code/)]) }));
  });

  test('a Principal HR Officer can add directorates (with their full name); an existing position at another level is a warning', async () => {
    const result = await run([
      'DANS,Air Navigation Services,AIM,Aeronautical Information Management,AISO,AIS Officer,Officer',
      'DANS,,AIM,,SAISO,Senior AIS Officer,Senior',
      'DHRA,,HR,,HRA,HR Analyst,Senior',
      'DAAS,,OPS,Operations,,,',
      'DSSER,Finance,X,X,,,'
    ], { canAddDirectorates: true });
    expect(result.rows.map((r) => [r.status, r.creates.join('+')])).toEqual([
      ['new', 'directorate+department+position'], ['new', 'position'], ['warning', ''], ['error', ''], ['error', '']
    ]);
    expect(result.rows[2].messages[0]).toBe('Position already exists as Officer - not changed');
    expect(result.rows[3].messages[0]).toMatch(/Directorate DAAS is new - give its full name/);
    expect(result.rows[4].messages[0]).toMatch(/Directorate "Finance" already exists with the code DF - use that code/);
    expect(result.toCreate.directorates).toEqual([{ code: 'DANS', name: 'Air Navigation Services', rowNumber: 2 }]);
  });
});

describe('importing', () => {
  const FILE = [
    HEAD,
    'DANS,Air Navigation Services,AIM,Aeronautical Information Management,AISO,AIS Officer,Officer',
    'DHRA,,HR,,SHRO,Senior HR Officer,Senior',
    'DHRA,,HR,,HRA,HR Analyst,Officer'
  ].join('\n');
  const arrange = () => {
    prisma.orgImport.create.mockResolvedValue({ id: 7, fileName: 'org.csv' });
    prisma.directorate.create.mockResolvedValue({ id: 3 });
    prisma.department.create.mockResolvedValueOnce({ id: 20 });
    prisma.department.findFirst.mockResolvedValue({ id: 10 });
    prisma.directorate.findUnique.mockResolvedValue({ id: 1 });
  };

  test('creates everything in one transaction with codes and names, all pending and tied to the import', async () => {
    arrange();
    const result = await orgImport.run(csvFile(FILE), { staffId: 5, canAddDirectorates: true });

    expect(result).toEqual({ importId: 7, fileName: 'org.csv', autoApproved: false, directorates: 1, departments: 1, positions: 2, skipped: 1 });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.orgImport.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      fileName: 'org.csv', createdById: 5, directoratesCreated: 1, departmentsProposed: 1, positionsCreated: 2, rowsSkipped: 1, autoApproved: false
    }) });
    expect(prisma.directorate.create).toHaveBeenCalledWith({ data: { code: 'DANS', name: 'Air Navigation Services', createdById: 5, importId: 7, status: 'Pending' } });
    expect(prisma.department.create).toHaveBeenCalledWith({
      data: { code: 'AIM', name: 'Aeronautical Information Management', directorateId: 3, status: 'Pending', createdById: 5, importId: 7 }
    });
    expect(prisma.directorate.findUnique).toHaveBeenCalledWith({ where: { code: 'DHRA' } });
    expect(prisma.department.findFirst).toHaveBeenCalledWith({ where: { code: 'HR', directorateId: 1 }, select: { id: true } });
    expect(prisma.position.create.mock.calls.map((c) => c[0].data)).toEqual([
      { code: 'AISO', name: 'AIS Officer', departmentId: 20, level: 1, createdById: 5, importId: 7, status: 'Pending' },
      { code: 'SHRO', name: 'Senior HR Officer', departmentId: 10, level: 2, createdById: 5, importId: 7, status: 'Pending' }
    ]);
  });

  test('"Approve now" (autoApproved) creates everything approved by the importer', async () => {
    arrange();
    await orgImport.run(csvFile(FILE), { staffId: 5, canAddDirectorates: true, autoApproved: true });

    const approved = { status: 'Approved', approvedById: 5, approvedAt: expect.any(Date) };
    expect(prisma.orgImport.create.mock.calls[0][0].data.autoApproved).toBe(true);
    expect(prisma.directorate.create.mock.calls[0][0].data).toEqual(expect.objectContaining(approved));
    expect(prisma.department.create.mock.calls[0][0].data).toEqual(expect.objectContaining(approved));
    prisma.position.create.mock.calls.forEach(([arg]) => expect(arg.data).toEqual(expect.objectContaining(approved)));
  });

  test('imports nothing while any row has an error, and returns the rows', async () => {
    await expect(orgImport.run(csvFile(`${HEAD}\nDHRA,,HR,,A,A,Officer\nDHRA,,HR,,B,B,Chief\n`), { staffId: 5, canAddDirectorates: false }))
      .rejects.toMatchObject({ status: 422, code: 'IMPORT_HAS_ERRORS', details: { summary: expect.objectContaining({ errors: 1 }) } });
    expect(prisma.orgImport.create).not.toHaveBeenCalled();
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('a file with nothing new says so', async () => {
    await expect(orgImport.run(csvFile(`${HEAD}\nDHRA,,HR,,HRA,HR Analyst,Officer\n`), { staffId: 5, canAddDirectorates: false }))
      .rejects.toThrow(/already there - nothing to import/);
  });
});

test('the template is a workbook the import reads back', async () => {
  const buffer = await orgImport.template();
  const rows = await orgImport.readFile({ originalname: 'org-structure-import-template.xlsx', buffer: Buffer.from(buffer) });
  expect(rows[0]).toEqual({
    rowNumber: 2, directorate: 'DHRA', directorateName: 'Human Resource and Administration', department: 'HR', departmentName: 'Human Resource',
    positionCode: 'HRO', position: 'Human Resource Officer', level: 'Officer'
  });
  expect(rows).toHaveLength(4);
});
