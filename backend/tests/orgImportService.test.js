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

const DIRECTORATES = [{ id: 1, name: 'DHRA' }, { id: 2, name: 'DF' }];
const DEPARTMENTS = [
  { id: 10, name: 'HR', directorateId: 1, status: 'Approved' },
  { id: 11, name: 'LD', directorateId: 1, status: 'Pending' },
  { id: 12, name: 'Payroll', directorateId: 2, status: 'Rejected', rejectionReason: 'Merged into FINANCE' }
];
const POSITIONS = [{ id: 100, name: 'HR Analyst', departmentId: 10, level: 1 }];

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
  test('CSV with quoted fields, a byte-order mark, CRLF line ends and blank rows', async () => {
    const rows = await orgImport.readFile(csvFile('﻿Directorate,Department,Position,Level\r\nDHRA,HR,"Officer, Recruitment",Officer\r\n,,,\r\nDF,"FINANCE ""A""",,\r\n'));
    expect(rows).toEqual([
      { rowNumber: 2, directorate: 'DHRA', department: 'HR', position: 'Officer, Recruitment', level: 'Officer' },
      { rowNumber: 4, directorate: 'DF', department: 'FINANCE "A"', position: '', level: '' }
    ]);
  });

  test('Excel, with headings in any order and other columns ignored', async () => {
    const file = await xlsxFile([['Level', 'Notes', 'Position', 'Department', 'Directorate'], ['Senior', 'x', 'Senior HR Officer', 'HR', 'DHRA']]);
    expect(await orgImport.readFile(file)).toEqual([
      { rowNumber: 2, directorate: 'DHRA', department: 'HR', position: 'Senior HR Officer', level: 'Senior' }
    ]);
  });

  test('refuses other file types, missing headings and empty files', async () => {
    await expect(orgImport.readFile(csvFile('x', 'org.pdf'))).rejects.toMatchObject({ status: 400 });
    await expect(orgImport.readFile(csvFile('Name,Level\nHR,Officer\n'))).rejects.toThrow(/missing directorate and department/);
    await expect(orgImport.readFile(csvFile('Directorate,Department\n'))).rejects.toThrow(/no rows/);
    await expect(orgImport.readFile({ originalname: 'org.xlsx', buffer: Buffer.from('not a workbook') })).rejects.toThrow(/could not be read/);
  });
});

describe('checking the rows', () => {
  const run = async (csv, options = { canAddDirectorates: false }) => orgImport.plan(await orgImport.readFile(csvFile(csv)), options);

  test('new positions, departments and what already exists', async () => {
    const result = await run([
      'Directorate,Department,Position,Level',
      'DHRA,HR,HR Analyst,Officer', // exists
      'DHRA,hr,Senior HR Officer,senior', // new position, department matched case-insensitively
      'DHRA,ADMIN,Office Administrator,Officer', // new department and position
      'DHRA,ADMIN,,', // department already being added
      'DHRA,LD,Training Officer,Officer' // pending department
    ].join('\n'));

    expect(result.rows.map((r) => [r.status, r.creates.join('+'), r.messages.join('; ')])).toEqual([
      ['exists', '', 'Position already exists'],
      ['new', 'position', ''],
      ['new', 'department+position', ''],
      ['exists', '', ''],
      ['new', 'position', 'Department is awaiting approval']
    ]);
    expect(result.summary).toEqual(expect.objectContaining({ errors: 0, directorates: 0, departments: 1, positions: 3, skipped: 2 }));
  });

  test('errors that must be fixed first', async () => {
    const result = await run([
      'Directorate,Department,Position,Level',
      'DANS,AIM,AIS Officer,Officer', // unknown directorate, not allowed to add
      'DHRA,HR,Records Clerk,Assistant', // not a level
      'DHRA,HR,Records Officer,', // level missing
      'DHRA,HR,,Senior', // level without position
      'DF,Payroll,Payroll Officer,Officer', // rejected department
      'DHRA,HR,Talent Lead,Senior',
      'DHRA,HR,Talent Lead,Manager', // same position, different level
      ',HR,X,Officer'
    ].join('\n'));

    const errors = result.rows.map((r) => (r.status === 'error' ? r.messages[0] : null));
    expect(errors[0]).toMatch(/Directorate "DANS" doesn't exist\. Only a Principal HR Officer/);
    expect(errors[1]).toMatch(/"Assistant" isn't a level - use one of Officer, Senior, Principal, Manager, Director/);
    expect(errors[2]).toMatch(/Level is missing/);
    expect(errors[3]).toMatch(/Level is given but Position is empty/);
    expect(errors[4]).toMatch(/was rejected \(Merged into FINANCE\)/);
    expect(errors[5]).toBeNull();
    expect(errors[6]).toMatch(/Row 7 has the same position as Senior/);
    expect(errors[7]).toMatch(/Directorate is missing/);
    expect(result.summary.errors).toBe(7);
  });

  test('rejected directorates and positions can\'t be imported again; pending ones are noted', async () => {
    prisma.directorate.findMany.mockResolvedValue([...DIRECTORATES, { id: 3, name: 'DOLD', status: 'Rejected', rejectionReason: 'Abolished' }, { id: 4, name: 'DNEW', status: 'Pending' }]);
    prisma.position.findMany.mockResolvedValue([...POSITIONS,
      { id: 101, name: 'Clerk', departmentId: 10, level: 1, status: 'Rejected', rejectionReason: 'Not on the establishment' },
      { id: 102, name: 'Coach', departmentId: 10, level: 1, status: 'Pending' }]);
    const result = await run([
      'Directorate,Department,Position,Level',
      'DOLD,X,,',
      'DHRA,HR,Clerk,Officer',
      'DHRA,HR,Coach,Officer',
      'DNEW,Y,,'
    ].join('\n'));
    expect(result.rows[0].messages[0]).toMatch(/Directorate "DOLD" was rejected \(Abolished\)/);
    expect(result.rows[1].messages[0]).toMatch(/Position "Clerk" was rejected \(Not on the establishment\)/);
    expect(result.rows[2].messages).toEqual(['Position is awaiting approval', 'Position already exists']);
    expect(result.rows[3]).toEqual(expect.objectContaining({ status: 'new', messages: ['Directorate is awaiting approval'] }));
  });

  test('a Principal HR Officer can add directorates; an existing position at another level is a warning, not an error', async () => {
    const result = await run([
      'Directorate,Department,Position,Level',
      'DANS,AIM,AIS Officer,Officer',
      'DANS,AIM,Senior AIS Officer,Senior',
      'DHRA,HR,HR Analyst,Senior'
    ].join('\n'), { canAddDirectorates: true });
    expect(result.rows.map((r) => [r.status, r.creates.join('+')])).toEqual([
      ['new', 'directorate+department+position'], ['new', 'position'], ['warning', '']
    ]);
    expect(result.rows[2].messages[0]).toBe('Position already exists as Officer - not changed');
    expect(result.summary).toEqual(expect.objectContaining({ errors: 0, warnings: 1, directorates: 1, departments: 1, positions: 2 }));
  });
});

describe('importing', () => {
  const FILE = [
    'Directorate,Department,Position,Level',
    'DANS,AIM,AIS Officer,Officer',
    'DHRA,HR,Senior HR Officer,Senior',
    'DHRA,HR,HR Analyst,Officer'
  ].join('\n');
  const arrange = () => {
    prisma.orgImport.create.mockResolvedValue({ id: 7, fileName: 'org.csv' });
    prisma.directorate.create.mockResolvedValue({ id: 3 });
    prisma.department.create.mockResolvedValueOnce({ id: 20 });
    prisma.department.findFirst.mockResolvedValue({ id: 10 });
    prisma.directorate.findUnique.mockResolvedValue({ id: 1 });
  };

  test('creates everything in one transaction, all pending and tied to the import', async () => {
    arrange();
    const result = await orgImport.run(csvFile(FILE), { staffId: 5, canAddDirectorates: true });

    expect(result).toEqual({ importId: 7, fileName: 'org.csv', autoApproved: false, directorates: 1, departments: 1, positions: 2, skipped: 1 });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.orgImport.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      fileName: 'org.csv', createdById: 5, directoratesCreated: 1, departmentsProposed: 1, positionsCreated: 2, rowsSkipped: 1, autoApproved: false
    }) });
    expect(prisma.directorate.create).toHaveBeenCalledWith({ data: { name: 'DANS', createdById: 5, importId: 7, status: 'Pending' } });
    expect(prisma.department.create).toHaveBeenCalledWith({ data: { name: 'AIM', directorateId: 3, status: 'Pending', createdById: 5, importId: 7 } });
    expect(prisma.position.create.mock.calls.map((c) => c[0].data)).toEqual([
      { name: 'AIS Officer', departmentId: 20, level: 1, createdById: 5, importId: 7, status: 'Pending' },
      { name: 'Senior HR Officer', departmentId: 10, level: 2, createdById: 5, importId: 7, status: 'Pending' }
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
    await expect(orgImport.run(csvFile('Directorate,Department,Position,Level\nDHRA,HR,A,Officer\nDHRA,HR,B,Chief\n'), { staffId: 5, canAddDirectorates: false }))
      .rejects.toMatchObject({ status: 422, code: 'IMPORT_HAS_ERRORS', details: { summary: expect.objectContaining({ errors: 1 }) } });
    expect(prisma.orgImport.create).not.toHaveBeenCalled();
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  test('a file with nothing new says so', async () => {
    await expect(orgImport.run(csvFile('Directorate,Department,Position,Level\nDHRA,HR,HR Analyst,Officer\n'), { staffId: 5, canAddDirectorates: false }))
      .rejects.toThrow(/already there - nothing to import/);
  });
});

test('the template is a workbook the import reads back', async () => {
  const buffer = await orgImport.template();
  const rows = await orgImport.readFile({ originalname: 'org-structure-import-template.xlsx', buffer: Buffer.from(buffer) });
  expect(rows[0]).toEqual({ rowNumber: 2, directorate: 'DHRA', department: 'HR', position: 'Human Resource Officer', level: 'Officer' });
  expect(rows).toHaveLength(4);
});
