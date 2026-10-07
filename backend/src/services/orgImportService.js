const ExcelJS = require('exceljs');
const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');
const { POSITION_LEVELS, LEVEL_WORDS, levelFromInput, levelLabel } = require('../utils/positionLevels');

// Batch import of the org structure - directorates, departments and
// positions - from one spreadsheet (.xlsx or .csv), one row per position:
//
//   Directorate | Department | Position | Level
//   DHRA        | HR         | HR Analyst | Officer
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
  directorate: ['directorate'],
  department: ['department'],
  position: ['position', 'position name', 'job title', 'title'],
  level: ['level', 'seniority', 'seniority level']
};

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
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
    for (let c = 1; c <= Math.max(r.cellCount, 4); c++) values.push(r.getCell(c).text);
    rows[rowNumber - 1] = values;
  });
  return Array.from(rows, (r) => r || []);
}

// Returns [{ rowNumber, directorate, department, position, level }] - the
// row number as the person sees it in their spreadsheet.
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
    throw new AppError(`The first row must be the column headings: Directorate, Department, Position, Level (missing ${missing.join(' and ')}). Download the template for the layout.`, 422);
  }

  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const cell = (field) => (col[field] === undefined ? '' : clean(r[col[field]]));
    const row = { rowNumber: i + 1, directorate: cell('directorate'), department: cell('department'), position: cell('position'), level: cell('level') };
    if (!row.directorate && !row.department && !row.position && !row.level) continue;
    rows.push(row);
  }
  if (rows.length === 0) throw new AppError('The file has headings but no rows to import', 422);
  if (rows.length > MAX_ROWS) throw new AppError(`At most ${MAX_ROWS} rows can be imported at once - split the file`, 422);
  return rows;
}

// --- Checking it against what exists ---------------------------------------

// Each row gets a status - 'new' (something will be created), 'exists'
// (already there, skipped), 'warning' (skipped, but worth a look) or
// 'error' (must be fixed before anything is imported) - and a message.
async function plan(rows, { canAddDirectorates }) {
  const [directorates, departments, positions] = await Promise.all([
    prisma.directorate.findMany({ select: { id: true, name: true, status: true, rejectionReason: true } }),
    prisma.department.findMany({ select: { id: true, name: true, directorateId: true, status: true, rejectionReason: true } }),
    prisma.position.findMany({ select: { id: true, name: true, departmentId: true, level: true, status: true, rejectionReason: true } })
  ]);
  const dirByName = new Map(directorates.map((d) => [key(d.name), d]));
  const deptByKey = new Map(departments.map((d) => [key(d.directorateId, d.name), d]));
  const posByKey = new Map(positions.map((p) => [key(p.departmentId, p.name), p]));

  // What this file adds, by name, so later rows see earlier ones.
  const newDirectorates = new Map(); // key -> { name }
  const newDepartments = new Map(); // key(directorate, department) -> { directorate, name }
  const newPositions = new Map(); // key(directorate, department, position) -> { ..., level, rowNumber }

  const results = rows.map((row) => {
    const out = { ...row, levelLabel: null, status: 'exists', messages: [], creates: [] };
    const fail = (message) => { out.status = 'error'; out.messages.push(message); return out; };

    if (!row.directorate) return fail('Directorate is missing');
    if (!row.department) return fail('Department is missing');
    if ([row.directorate, row.department, row.position].some((v) => v.length > MAX_NAME)) return fail(`Names can be at most ${MAX_NAME} characters`);

    let level = null;
    if (row.position) {
      if (!row.level) return fail(`Level is missing - use one of ${LEVEL_WORDS.join(', ')}`);
      level = levelFromInput(row.level);
      if (!level) return fail(`"${row.level}" isn't a level - use one of ${LEVEL_WORDS.join(', ')}`);
      out.levelLabel = levelLabel(level);
    } else if (row.level) {
      return fail('Level is given but Position is empty');
    }

    // Directorate
    const dirKey = key(row.directorate);
    const existingDir = dirByName.get(dirKey);
    if (existingDir && existingDir.status === 'Rejected') {
      return fail(`Directorate "${row.directorate}" was rejected${existingDir.rejectionReason ? ` (${existingDir.rejectionReason})` : ''} - it can't be imported again`);
    }
    if (existingDir && existingDir.status === 'Pending') out.messages.push('Directorate is awaiting approval');
    if (!existingDir) {
      if (!canAddDirectorates) {
        return fail(`Directorate "${row.directorate}" doesn't exist. Only a Principal HR Officer or above can add a directorate - ask one to add it or to import this file.`);
      }
      if (!newDirectorates.has(dirKey)) {
        newDirectorates.set(dirKey, { name: row.directorate });
        out.creates.push('directorate');
      }
    }

    // Department
    const deptFileKey = key(row.directorate, row.department);
    const existingDept = existingDir ? deptByKey.get(key(existingDir.id, row.department)) : null;
    if (existingDept && existingDept.status === 'Rejected') {
      return fail(`Department "${row.department}" under ${row.directorate} was rejected${existingDept.rejectionReason ? ` (${existingDept.rejectionReason})` : ''} - it can't be imported again`);
    }
    if (!existingDept && !newDepartments.has(deptFileKey)) {
      newDepartments.set(deptFileKey, { directorate: row.directorate, name: row.department });
      out.creates.push('department');
    }
    if (existingDept && existingDept.status === 'Pending') out.messages.push('Department is awaiting approval');

    // Position
    if (row.position) {
      const posFileKey = key(row.directorate, row.department, row.position);
      const existingPos = existingDept ? posByKey.get(key(existingDept.id, row.position)) : null;
      const earlier = newPositions.get(posFileKey);
      if (existingPos && existingPos.status === 'Rejected') {
        return fail(`Position "${row.position}" was rejected${existingPos.rejectionReason ? ` (${existingPos.rejectionReason})` : ''} - it can't be imported again`);
      }
      if (existingPos) {
        if (existingPos.status === 'Pending') out.messages.push('Position is awaiting approval');
        if (existingPos.level !== level) {
          out.status = 'warning';
          out.messages.push(`Position already exists as ${levelLabel(existingPos.level)} - not changed`);
        } else {
          out.messages.push('Position already exists');
        }
      } else if (earlier) {
        if (earlier.level !== level) return fail(`Row ${earlier.rowNumber} has the same position as ${levelLabel(earlier.level)}`);
        out.messages.push(`Same as row ${earlier.rowNumber}`);
      } else {
        newPositions.set(posFileKey, { directorate: row.directorate, department: row.department, name: row.position, level, rowNumber: row.rowNumber });
        out.creates.push('position');
      }
    }

    if (out.creates.length) out.status = out.status === 'warning' ? 'warning' : 'new';
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
      const created = await tx.directorate.create({ data: { name: d.name, createdById: staffId, importId: record.id, ...approval } });
      dirIds.set(key(d.name), created.id);
    }
    const dirId = async (name) => {
      if (!dirIds.has(key(name))) {
        const found = await tx.directorate.findUnique({ where: { name } });
        dirIds.set(key(name), found.id);
      }
      return dirIds.get(key(name));
    };

    const deptIds = new Map();
    for (const d of departments) {
      const created = await tx.department.create({
        data: { name: d.name, directorateId: await dirId(d.directorate), createdById: staffId, importId: record.id, ...approval }
      });
      deptIds.set(key(d.directorate, d.name), created.id);
    }
    const deptId = async (directorate, name) => {
      const k = key(directorate, name);
      if (!deptIds.has(k)) {
        const found = await tx.department.findFirst({ where: { name, directorateId: await dirId(directorate) }, select: { id: true } });
        deptIds.set(k, found.id);
      }
      return deptIds.get(k);
    };

    for (const p of positions) {
      await tx.position.create({
        data: { name: p.name, departmentId: await deptId(p.directorate, p.department), level: p.level, createdById: staffId, importId: record.id, ...approval }
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
    { header: 'Directorate', key: 'directorate', width: 18 },
    { header: 'Department', key: 'department', width: 24 },
    { header: 'Position', key: 'position', width: 36 },
    { header: 'Level', key: 'level', width: 14 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  [
    ['DHRA', 'HR', 'Human Resource Officer', 'Officer'],
    ['DHRA', 'HR', 'Senior Human Resource Officer', 'Senior'],
    ['DHRA', 'HR', 'Principal Human Resource Officer', 'Principal'],
    ['DHRA', 'HR', 'Manager Human Resources', 'Manager']
  ].forEach((r) => sheet.addRow(r));
  // A dropdown of the five level words on the Level column.
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    sheet.getCell(`D${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${LEVEL_WORDS.join(',')}"`],
      showErrorMessage: true, errorTitle: 'Level', error: `Choose one of: ${LEVEL_WORDS.join(', ')}`
    };
  }

  const help = workbook.addWorksheet('How to fill this in');
  help.getColumn(1).width = 110;
  [
    'One row per position. Replace the example rows with your own.',
    '',
    'Directorate - its short name as used in the system, e.g. DHRA, DANS, DF.',
    'Department - its name within that directorate. The same name under two directorates is two departments.',
    `Position - the job title. Level - its seniority: ${POSITION_LEVELS.map((l) => l.label).join(', ')} (most junior first).`,
    'A row with no Position and no Level only makes sure the department exists.',
    '',
    'Nothing already in the system is changed - existing directorates, departments and positions are skipped.',
    'A Principal HR Officer or above can approve everything the import adds at once ("Approve now", ticked by default).',
    'Otherwise it all arrives pending, for a Principal HR Officer or above to approve together. Positions can be used on a vacancy once approved.',
    'New directorates can only be added by a Principal HR Officer or above.',
    '',
    'Upload this file on the Departments screen. You will see every row checked before anything is imported.'
  ].forEach((line) => help.addRow([line]));
  help.getRow(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

module.exports = { preview, run, template, readFile, plan, parseCsv, MAX_ROWS };
