const ExcelJS = require('exceljs');
const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');
const { POSITION_LEVELS, LEVEL_WORDS, levelFromInput, levelLabel } = require('../utils/positionLevels');
const { clean, normalizeCode, codeError, nameError } = require('../utils/orgFields');

// Batch import of the org structure - directorates, departments and
// positions - from one spreadsheet (.xlsx or .csv), one row per position,
// each level with its short code and full name (utils/orgFields.js):
//
//   Directorate code | Directorate name                  | Department code | Department name | Position code | Position        | Level
//   DHRA             | Human Resource and Administration | HR              | Human Resource  | HRO           | HR Officer      | Officer
//
// Directorates and departments are matched by code, positions by title
// within their department. The names (and a position's code) are needed
// only for what is new - once per new item is enough; an existing item's
// name in the file is compared but never changed. Older files with plain
// "Directorate" / "Department" columns are read as the codes.
//
// A row with no Position just makes sure its department exists. Nothing
// existing is changed: what is already there is skipped. What the import
// creates follows the one approval rule (orgApprovalService.js): a
// Principal HR Officer or above approves it all at once unless they untick
// "Approve now"; otherwise everything new arrives Pending, linked to this
// import (importId) so a reviewer can approve it together. New directorates
// need a Principal HR Officer or above, as on the single form.
//
// preview() and run() both read the file afresh - nothing is held between
// the two - and run() refuses while any row has an error, so a file is
// imported whole or not at all.

const MAX_ROWS = 2000;
const MAX_NAME = 191;

const COLUMNS = {
  directorate: ['directorate code', 'directorate'],
  directorateName: ['directorate name', 'directorate full name'],
  department: ['department code', 'department'],
  departmentName: ['department name', 'department full name'],
  positionCode: ['position code'],
  position: ['position', 'position title', 'position name', 'job title', 'title'],
  level: ['level', 'seniority', 'seniority level']
};
const HEADINGS = 'Directorate code, Directorate name, Department code, Department name, Position code, Position, Level';
const COLUMN_COUNT = 7;

const key = (...parts) => parts.map((p) => clean(p).toLowerCase()).join('\u0000');

// --- Reading the file -------------------------------------------------------

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new AppError('That file could not be read as an Excel workbook (.xlsx).', 422);
  }
  // The template's first sheet holds the data; its second is instructions.
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (r, rowNumber) => {
    const values = [];
    for (let c = 1; c <= Math.max(r.cellCount, COLUMN_COUNT); c++) values.push(r.getCell(c).text);
    rows[rowNumber - 1] = values;
  });
  return Array.from(rows, (r) => r || []);
}

// Returns [{ rowNumber, directorate, directorateName, department,
// departmentName, positionCode, position, level }] - directorate and
// department are the codes; the row number as the person sees it in their
// spreadsheet.
async function readFile(file) {
  if (!file) throw new AppError('Attach the spreadsheet to import (.xlsx or .csv)', 400);
  const name = (file.originalname || '').toLowerCase();
  let grid;
  if (name.endsWith('.xlsx')) grid = await readXlsx(file.buffer);
  else if (name.endsWith('.csv')) grid = parseCsv(file.buffer.toString('utf8'));
  else throw new AppError('Upload an Excel workbook (.xlsx) or a CSV file (.csv)', 400);

  const headerIndex = grid.findIndex((r) => r.some((v) => clean(v)));
  if (headerIndex === -1) throw new AppError('The file is empty', 422);
  const header = grid[headerIndex].map((h) => clean(h).toLowerCase());
  const col = {};
  for (const [field, names] of Object.entries(COLUMNS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i !== -1) col[field] = i;
  }
  const missing = ['directorate', 'department'].filter((f) => col[f] === undefined);
  if (missing.length) {
    throw new AppError(`The first row must be the column headings: ${HEADINGS} (missing ${missing.map((m) => `${m} code`).join(' and ')}). Download the template for the layout.`, 422);
  }

  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const cell = (field) => (col[field] === undefined ? '' : clean(r[col[field]]));
    const row = { rowNumber: i + 1 };
    for (const field of Object.keys(COLUMNS)) row[field] = cell(field);
    row.directorate = normalizeCode(row.directorate);
    row.department = normalizeCode(row.department);
    row.positionCode = normalizeCode(row.positionCode);
    if (Object.keys(COLUMNS).every((field) => !row[field])) continue;
    rows.push(row);
  }
  if (rows.length === 0) throw new AppError('The file has headings but no rows to import', 422);
  if (rows.length > MAX_ROWS) throw new AppError(`At most ${MAX_ROWS} rows can be imported at once - split the file`, 422);
  return rows;
}

// --- Checking it against what exists ---------------------------------------

// Each row gets a status - 'new' (something will be created), 'exists'
// (already there, skipped), 'warning' (worth a look: a name or code in the
// file that differs from what is stored, which is not changed) or 'error'
// (must be fixed before anything is imported) - and messages.
async function plan(rows, { canAddDirectorates }) {
  const [directorates, departments, positions] = await Promise.all([
    prisma.directorate.findMany({ select: { id: true, code: true, name: true, status: true, rejectionReason: true } }),
    prisma.department.findMany({ select: { id: true, code: true, name: true, directorateId: true, status: true, rejectionReason: true } }),
    prisma.position.findMany({ select: { id: true, code: true, name: true, departmentId: true, level: true, status: true, rejectionReason: true } })
  ]);
  const dirByCode = new Map(directorates.map((d) => [key(d.code), d]));
  const dirByName = new Map(directorates.map((d) => [key(d.name), d]));
  const deptByCode = new Map(departments.map((d) => [key(d.directorateId, d.code), d]));
  const deptByName = new Map(departments.map((d) => [key(d.directorateId, d.name), d]));
  const posByName = new Map(positions.map((p) => [key(p.departmentId, p.name), p]));
  const posByCode = new Map(positions.filter((p) => p.code).map((p) => [key(p.departmentId, p.code), p]));

  // What this file adds, so later rows see earlier ones. A new item's scope
  // is 'new:<code>' until it has an id.
  const newDirectorates = new Map(); // code -> { code, name, rowNumber }
  const newDirectorateNames = new Map(); // name -> code
  const newDepartments = new Map(); // key(dirScope, code) -> { directorate, code, name, rowNumber }
  const newDepartmentNames = new Map(); // key(dirScope, name) -> code
  const newPositions = new Map(); // key(dirCode, deptCode, title) -> { ..., code, level, rowNumber }
  const newPositionCodes = new Map(); // key(dirCode, deptCode, code) -> title

  const results = rows.map((row) => {
    const out = { ...row, levelLabel: null, status: 'exists', messages: [], creates: [] };
    const fail = (message) => { out.status = 'error'; out.messages.push(message); return out; };
    const warn = (message) => { out.status = 'warning'; out.messages.push(message); };
    const rejected = (what, item) => fail(`${what} was rejected${item.rejectionReason ? ` (${item.rejectionReason})` : ''} - it can't be imported again`);

    if (!row.directorate) return fail('Directorate code is missing');
    if (!row.department) return fail('Department code is missing');
    const badCode = codeError(row.directorate, 'directorate') || codeError(row.department, 'department')
      || (row.positionCode && codeError(row.positionCode, 'position'));
    if (badCode) return fail(badCode);
    if ([row.directorateName, row.departmentName, row.position].some((v) => v.length > MAX_NAME)) return fail(`Names can be at most ${MAX_NAME} characters`);

    let level = null;
    if (row.position) {
      if (!row.level) return fail(`Level is missing - use one of ${LEVEL_WORDS.join(', ')}`);
      level = levelFromInput(row.level);
      if (!level) return fail(`"${row.level}" isn't a level - use one of ${LEVEL_WORDS.join(', ')}`);
      out.levelLabel = levelLabel(level);
    } else if (row.level || row.positionCode) {
      return fail('Position is empty but a position code or level is given');
    }

    // Directorate, by code
    const dirCode = row.directorate;
    const existingDir = dirByCode.get(key(dirCode));
    let dirScope;
    if (existingDir) {
      if (existingDir.status === 'Rejected') return rejected(`Directorate ${dirCode}`, existingDir);
      if (existingDir.status === 'Pending') out.messages.push('Directorate is awaiting approval');
      if (row.directorateName && key(row.directorateName) !== key(existingDir.name)) {
        warn(`Directorate ${dirCode} is "${existingDir.name}" in the system - the name in the file is not used`);
      }
      dirScope = existingDir.id;
    } else {
      const sameName = row.directorateName && dirByName.get(key(row.directorateName));
      if (sameName) return fail(`Directorate "${sameName.name}" already exists with the code ${sameName.code} - use that code`);
      if (!canAddDirectorates) {
        return fail(`Directorate ${dirCode} doesn't exist. Only a Principal HR Officer or above can add a directorate - ask one to add it or to import this file.`);
      }
      const earlier = newDirectorates.get(dirCode);
      if (!earlier) {
        const missingName = nameError(row.directorateName, 'directorate');
        if (missingName) return fail(`Directorate ${dirCode} is new - give its full name in "Directorate name"`);
        const otherCode = newDirectorateNames.get(key(row.directorateName));
        if (otherCode) return fail(`"${row.directorateName}" is also given the code ${otherCode} in this file`);
        newDirectorates.set(dirCode, { code: dirCode, name: row.directorateName, rowNumber: row.rowNumber });
        newDirectorateNames.set(key(row.directorateName), dirCode);
        out.creates.push('directorate');
      } else if (row.directorateName && key(row.directorateName) !== key(earlier.name)) {
        return fail(`Row ${earlier.rowNumber} gives directorate ${dirCode} the name "${earlier.name}"`);
      }
      dirScope = `new:${dirCode}`;
    }

    // Department, by code within the directorate
    const deptCode = row.department;
    const existingDept = existingDir ? deptByCode.get(key(existingDir.id, deptCode)) : null;
    if (existingDept) {
      if (existingDept.status === 'Rejected') return rejected(`Department ${deptCode} under ${dirCode}`, existingDept);
      if (existingDept.status === 'Pending') out.messages.push('Department is awaiting approval');
      if (row.departmentName && key(row.departmentName) !== key(existingDept.name)) {
        warn(`Department ${deptCode} is "${existingDept.name}" in the system - the name in the file is not used`);
      }
    } else {
      const sameName = existingDir && row.departmentName && deptByName.get(key(existingDir.id, row.departmentName));
      if (sameName) return fail(`Department "${sameName.name}" already exists under ${dirCode} with the code ${sameName.code} - use that code`);
      const deptKey = key(dirScope, deptCode);
      const earlier = newDepartments.get(deptKey);
      if (!earlier) {
        if (nameError(row.departmentName, 'department')) return fail(`Department ${deptCode} is new - give its full name in "Department name"`);
        const otherCode = newDepartmentNames.get(key(dirScope, row.departmentName));
        if (otherCode) return fail(`"${row.departmentName}" is also given the code ${otherCode} under ${dirCode} in this file`);
        newDepartments.set(deptKey, { directorate: dirCode, code: deptCode, name: row.departmentName, rowNumber: row.rowNumber });
        newDepartmentNames.set(key(dirScope, row.departmentName), deptCode);
        out.creates.push('department');
      } else if (row.departmentName && key(row.departmentName) !== key(earlier.name)) {
        return fail(`Row ${earlier.rowNumber} gives department ${deptCode} the name "${earlier.name}"`);
      }
    }

    // Position, by title within the department
    if (row.position) {
      const posCode = row.positionCode;
      const existingPos = existingDept ? posByName.get(key(existingDept.id, row.position)) : null;
      const fileKey = key(dirCode, deptCode, row.position);
      const earlier = newPositions.get(fileKey);
      if (existingPos) {
        if (existingPos.status === 'Rejected') return rejected(`Position "${row.position}"`, existingPos);
        if (existingPos.status === 'Pending') out.messages.push('Position is awaiting approval');
        if (posCode && existingPos.code && posCode !== existingPos.code) {
          warn(`Position already exists with the code ${existingPos.code} - not changed`);
        } else if (posCode && !existingPos.code) {
          warn('Position already exists without a code - give it one on the Positions page');
        }
        if (existingPos.level !== level) {
          warn(`Position already exists as ${levelLabel(existingPos.level)} - not changed`);
        } else if (out.status !== 'warning') {
          out.messages.push('Position already exists');
        }
      } else if (earlier) {
        if (earlier.level !== level) return fail(`Row ${earlier.rowNumber} has the same position as ${levelLabel(earlier.level)}`);
        if (posCode && posCode !== earlier.code) return fail(`Row ${earlier.rowNumber} gives this position the code ${earlier.code}`);
        out.messages.push(`Same as row ${earlier.rowNumber}`);
      } else {
        if (!posCode) return fail('Position code is missing - a new position needs its short code');
        const codeOwner = existingDept && posByCode.get(key(existingDept.id, posCode));
        if (codeOwner) return fail(`The code ${posCode} is already used by "${codeOwner.name}" in this department`);
        const fileOwner = newPositionCodes.get(key(dirCode, deptCode, posCode));
        if (fileOwner) return fail(`The code ${posCode} is also given to "${fileOwner}" in this file`);
        newPositions.set(fileKey, {
          directorate: dirCode, department: deptCode, code: posCode, name: row.position, level, rowNumber: row.rowNumber
        });
        newPositionCodes.set(key(dirCode, deptCode, posCode), row.position);
        out.creates.push('position');
      }
    }

    if (out.creates.length && out.status !== 'warning') out.status = 'new';
    return out;
  });

  const errors = results.filter((r) => r.status === 'error').length;
  return {
    rows: results,
    summary: {
      rows: results.length,
      errors,
      warnings: results.filter((r) => r.status === 'warning').length,
      directorates: newDirectorates.size,
      departments: newDepartments.size,
      positions: newPositions.size,
      skipped: results.filter((r) => r.creates.length === 0 && r.status !== 'error').length
    },
    toCreate: { directorates: [...newDirectorates.values()], departments: [...newDepartments.values()], positions: [...newPositions.values()] }
  };
}

async function preview(file, options) {
  const result = await plan(await readFile(file), options);
  return { fileName: file.originalname, rows: result.rows, summary: result.summary };
}

// --- Importing --------------------------------------------------------------

// autoApproved: the importer is PHRO+ and left "Approve now" ticked - what
// is created is Approved at once; otherwise it is all Pending.
async function run(file, { staffId, canAddDirectorates, autoApproved = false }) {
  const result = await plan(await readFile(file), { canAddDirectorates });
  if (result.summary.errors > 0) {
    const err = new AppError(`${result.summary.errors} row(s) need fixing before anything is imported`, 422);
    err.code = 'IMPORT_HAS_ERRORS';
    err.details = { rows: result.rows, summary: result.summary };
    throw err;
  }
  const { directorates, departments, positions } = result.toCreate;
  if (!directorates.length && !departments.length && !positions.length) {
    throw new AppError('Everything in this file is already there - nothing to import', 422);
  }

  const approval = autoApproved
    ? { status: 'Approved', approvedById: staffId, approvedAt: new Date() }
    : { status: 'Pending' };

  return prisma.$transaction(async (tx) => {
    const record = await tx.orgImport.create({
      data: {
        fileName: String(file.originalname || 'import').slice(0, 255), createdById: staffId,
        directoratesCreated: directorates.length, departmentsProposed: departments.length,
        positionsCreated: positions.length, rowsSkipped: result.summary.skipped, autoApproved
      }
    });

    const dirIds = new Map();
    for (const d of directorates) {
      const created = await tx.directorate.create({ data: { code: d.code, name: d.name, createdById: staffId, importId: record.id, ...approval } });
      dirIds.set(d.code, created.id);
    }
    const dirId = async (code) => {
      if (!dirIds.has(code)) {
        const found = await tx.directorate.findUnique({ where: { code } });
        dirIds.set(code, found.id);
      }
      return dirIds.get(code);
    };

    const deptIds = new Map();
    for (const d of departments) {
      const created = await tx.department.create({
        data: { code: d.code, name: d.name, directorateId: await dirId(d.directorate), createdById: staffId, importId: record.id, ...approval }
      });
      deptIds.set(key(d.directorate, d.code), created.id);
    }
    const deptId = async (directorate, code) => {
      const k = key(directorate, code);
      if (!deptIds.has(k)) {
        const found = await tx.department.findFirst({ where: { code, directorateId: await dirId(directorate) }, select: { id: true } });
        deptIds.set(k, found.id);
      }
      return deptIds.get(k);
    };

    for (const p of positions) {
      await tx.position.create({
        data: {
          code: p.code, name: p.name, departmentId: await deptId(p.directorate, p.department), level: p.level,
          createdById: staffId, importId: record.id, ...approval
        }
      });
    }
    return {
      importId: record.id,
      fileName: record.fileName,
      autoApproved,
      directorates: directorates.length,
      departments: departments.length,
      positions: positions.length,
      skipped: result.summary.skipped
    };
  }, { timeout: 60000 });
}

// --- The template -----------------------------------------------------------

async function template() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Org structure');
  sheet.columns = [
    { header: 'Directorate code', key: 'directorate', width: 16 },
    { header: 'Directorate name', key: 'directorateName', width: 36 },
    { header: 'Department code', key: 'department', width: 16 },
    { header: 'Department name', key: 'departmentName', width: 30 },
    { header: 'Position code', key: 'positionCode', width: 14 },
    { header: 'Position', key: 'position', width: 36 },
    { header: 'Level', key: 'level', width: 14 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  [
    ['DHRA', 'Human Resource and Administration', 'HR', 'Human Resource', 'HRO', 'Human Resource Officer', 'Officer'],
    ['DHRA', 'Human Resource and Administration', 'HR', 'Human Resource', 'SHRO', 'Senior Human Resource Officer', 'Senior'],
    ['DHRA', 'Human Resource and Administration', 'HR', 'Human Resource', 'PHRO', 'Principal Human Resource Officer', 'Principal'],
    ['DHRA', 'Human Resource and Administration', 'HR', 'Human Resource', 'MHR', 'Manager Human Resources', 'Manager']
  ].forEach((r) => sheet.addRow(r));
  // A dropdown of the five level words on the Level column.
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    sheet.getCell(`G${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${LEVEL_WORDS.join(',')}"`],
      showErrorMessage: true, errorTitle: 'Level', error: `Choose one of: ${LEVEL_WORDS.join(', ')}`
    };
  }

  const help = workbook.addWorksheet('How to fill this in');
  help.getColumn(1).width = 110;
  [
    'One row per position. Replace the example rows with your own.',
    '',
    'Directorate code and name - its short code (e.g. DHRA, DANS, DF) and its full name (e.g. Human Resource and Administration).',
    'Department code and name - its short code and full name within that directorate. The same code under two directorates is two departments.',
    `Position code and Position - the job's short code (e.g. HRO) and its full title. Level - its seniority: ${POSITION_LEVELS.map((l) => l.label).join(', ')} (most junior first).`,
    'Codes can have letters, digits, spaces and & / . - (at most 20 characters).',
    'A row with no Position, Position code and Level only makes sure the department exists.',
    '',
    'Directorates and departments are matched by code, positions by title. Full names are needed only for new ones - once per new item is enough.',
    'Nothing already in the system is changed - existing directorates, departments and positions are skipped.',
    'A Principal HR Officer or above can approve everything the import adds at once ("Approve now", ticked by default).',
    'Otherwise it all arrives pending, for a Principal HR Officer or above to approve together. Positions can be used on a vacancy once approved.',
    'New directorates can only be added by a Principal HR Officer or above.',
    '',
    'Upload this file under Organisation > Overview. You will see every row checked before anything is imported.'
  ].forEach((line) => help.addRow([line]));
  help.getRow(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

module.exports = { preview, run, template, readFile, plan, parseCsv, MAX_ROWS };
