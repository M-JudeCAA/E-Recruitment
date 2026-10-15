// Seeds UCAA's organisation structure - directorates, departments and
// positions - from HR's workbook, scripts/data/ucaa-org-structure.xlsx (the
// Organisation import's layout: Directorate code/name, Department code/name,
// Position code, Position, Level). A row with no directorate is a department
// outside every directorate (the Director General's Office). Everything it
// creates is approved: the workbook is UCAA's agreed structure, not a
// proposal awaiting review.
//
// The database is made to match the workbook, keeping row ids so what uses
// them (vacancies, staff accounts, drafts) stays attached:
//   - directorates, departments and positions are matched by code (positions
//     also by title) and get the workbook's names, codes and levels;
//   - departments and positions renamed since the earlier structure are
//     carried over by DEPARTMENT_RENAMES / POSITION_MOVES below;
//   - anything else is created;
//   - what the workbook no longer has is deleted when nothing uses it, and
//     listed when something does (move or delete it on the Organisation pages);
//   - Corporate's head is the Deputy Director General (it has the DG and the
//     Corporation Secretary at Director level too, so it can't be worked out).
//
//   node scripts/seedDepartments.js             apply it
//   node scripts/seedDepartments.js --dry-run   say what it would change, change nothing
//   node scripts/seedDepartments.js --file <path.xlsx>   another workbook
const path = require('path');
const fs = require('fs');
const { readFile } = require('../src/services/orgImportService');
const { levelFromInput } = require('../src/utils/positionLevels');

const DEFAULT_FILE = path.join(__dirname, 'data', 'ucaa-org-structure.xlsx');

// Earlier department codes -> the workbook's, as "DIRECTORATE/CODE" (an empty
// directorate is "outside every directorate"). Any directorate's
// "DIR OFFICE" became "OD".
const DEPARTMENT_RENAMES = {
  'CORP/MCCS': 'CORP/MCS',
  'CORP/DG OFFICE': '/DGO',
  'CORP/AUDIT': 'CORP/IA',
  'CORP/LEGAL': 'CORP/LEG',
  'CORP/QA': 'CORP/QARM',
  'DAAS/OPS EIA': 'DAAS/AO',
  'DAAS/SMS': 'DAAS/SMSQA',
  'DANS/ATS': 'DANS/ATM',
  'DANS/TTSQA': 'DANS/SMSQA',
  'DF/ACCOUNTS': 'DF/ACC',
  'DF/FINANCE': 'DF/FIN',
  'DF/MGT ACCT': 'DF/MACC',
  'DHRA/ADMIN': 'DHRA/ADM',
  'DHRA/LD': 'DHRA/HRLD',
  'DSSER/ASFAL': 'DSSER/AVSECFPR'
};
const renamedDepartment = (oldKey) => DEPARTMENT_RENAMES[oldKey] || oldKey.replace(/\/DIR OFFICE$/, '/OD');

// Positions added before the workbook, by "DIRECTORATE/DEPARTMENT/TITLE"
// (the old codes, title upper-cased) -> the workbook position they are,
// "DIRECTORATE/DEPARTMENT/CODE" in the workbook's codes.
const POSITION_MOVES = {
  'CORP/IT/ICT INNOVATION OFFICER': 'CORP/IT/ICTIO',
  'CORP/IT/INFORMATION TECHNOLOGY HELP DESK ASSISTANT': 'CORP/IT/AITHDO',
  'CORP/IT/IT SYSTEMS SUPPORT OFFICER': 'CORP/IT/SSO',
  'CORP/MCCS/MANAGER MARKETING & COMMERCIAL': 'CORP/MCS/MMCCS',
  'CORP/DG OFFICE/DEPUTY DIRECTOR GENERAL': 'CORP/DDGO/DDG'
};

// The head of a directorate that has more than one Director-level position.
const DIRECTORATE_HEADS = { CORP: 'CORP/DDGO/DDG' };

const deptKey = (dirCode, code) => `${dirCode || ''}/${code}`.toUpperCase();
const upper = (v) => String(v || '').trim().toUpperCase();

// The workbook as { directorates: Map(code -> name), departments: Map(key ->
// { dirCode, code, name }), positions: Map(key/CODE -> { deptKey, code, name, level }) }.
async function readWorkbook(file) {
  const rows = await readFile({ originalname: path.basename(file), buffer: fs.readFileSync(file) });
  const directorates = new Map();
  const departments = new Map();
  const positions = new Map();
  const problems = [];
  for (const r of rows) {
    if (!r.directorate && r.directorateName) problems.push(`row ${r.rowNumber}: a directorate name with no code`);
    if (r.directorate) {
      const known = directorates.get(r.directorate);
      if (!known && !r.directorateName) problems.push(`row ${r.rowNumber}: directorate ${r.directorate} has no name`);
      if (!known || !known.name) directorates.set(r.directorate, { code: r.directorate, name: r.directorateName || known?.name });
    }
    const dk = deptKey(r.directorate, r.department);
    if (!departments.has(dk)) departments.set(dk, { dirCode: r.directorate || null, code: r.department, name: r.departmentName });
    else if (!departments.get(dk).name) departments.get(dk).name = r.departmentName;
    if (r.position) {
      const level = levelFromInput(r.level);
      if (!level) problems.push(`row ${r.rowNumber}: level "${r.level}"`);
      if (!r.positionCode) problems.push(`row ${r.rowNumber}: no position code`);
      positions.set(`${dk}/${r.positionCode}`, { deptKey: dk, code: r.positionCode, name: r.position, level });
    }
  }
  for (const [k, d] of departments) if (!d.name) problems.push(`department ${k} has no name`);
  if (problems.length) throw new Error(`The workbook needs fixing first:\n  ${problems.join('\n  ')}`);
  return { directorates, departments, positions };
}

// Makes the database match the workbook. Returns { changes, kept }: what it
// changed ('+ ...' created, '~ ...' changed, '- ...' deleted) and what the
// workbook no longer has but is in use. dryRun: the same, rolled back.
async function seed({ prisma, file = DEFAULT_FILE, dryRun = false, log = console.log }) {
  const DRY_RUN = dryRun;
  const FILE = file;
  const target = await readWorkbook(FILE);
  log(`${path.basename(FILE)}: ${target.directorates.size} directorates, ${target.departments.size} departments, ${target.positions.size} positions.${DRY_RUN ? ' Dry run - nothing is changed.' : ''}\n`);

  // Recorded as creator/approver of the seeded rows: a Director if there is
  // one, else a system administrator (a fresh database after
  // resetDemoData.js --remove-demo-staff may have only that), else anyone.
  const systemUser = await prisma.staffUser.findFirst({ where: { role: 'Director', active: true } })
    || await prisma.staffUser.findFirst({ where: { isSystemAdmin: true, active: true } })
    || await prisma.staffUser.findFirst();
  if (!systemUser) throw new Error('Create a staff account first (scripts/createSystemAdmin.js) - the structure needs a createdById.');
  const approved = () => ({ status: 'Approved', approvedById: systemUser.id, approvedAt: new Date(), rejectionReason: null });

  const changes = [];
  const note = (line) => changes.push(line);

  const run = async (tx) => {
    // --- Directorates --------------------------------------------------------
    const dirByCode = new Map();
    for (const row of await tx.directorate.findMany()) dirByCode.set(row.code, row);
    for (const d of target.directorates.values()) {
      const row = dirByCode.get(d.code);
      if (!row) {
        note(`+ directorate ${d.code} - ${d.name}`);
        dirByCode.set(d.code, await tx.directorate.create({ data: { code: d.code, name: d.name, createdById: systemUser.id, ...approved() } }));
      } else if (row.name !== d.name || row.status !== 'Approved') {
        note(`~ directorate ${d.code}: "${row.name}" -> "${d.name}"${row.status !== 'Approved' ? ', approved' : ''}`);
        dirByCode.set(d.code, await tx.directorate.update({ where: { id: row.id }, data: { name: d.name, ...(row.status !== 'Approved' ? approved() : {}) } }));
      }
    }
    const dirIdOf = (code) => (code ? dirByCode.get(code).id : null);

    // --- Departments ---------------------------------------------------------
    const existing = await tx.department.findMany({ include: { directorate: { select: { code: true } } } });
    const keyOf = (row) => deptKey(row.directorate?.code, row.code);
    const byKey = new Map(existing.map((row) => [keyOf(row), row]));
    const deptIds = new Map(); // workbook key -> department id
    const claimed = new Set();
    for (const [k, d] of target.departments) {
      // The department already under this code wins; else one renamed to it.
      const row = byKey.get(k)
        || existing.find((e) => !claimed.has(e.id) && !target.departments.has(keyOf(e)) && renamedDepartment(keyOf(e)) === k);
      const data = { code: d.code, name: d.name, directorateId: dirIdOf(d.dirCode) };
      if (!row) {
        note(`+ department ${k} - ${d.name}`);
        const created = await tx.department.create({ data: { ...data, createdById: systemUser.id, ...approved() } });
        deptIds.set(k, created.id);
        continue;
      }
      claimed.add(row.id);
      deptIds.set(k, row.id);
      const moved = keyOf(row) !== k;
      if (moved || row.name !== d.name || row.status !== 'Approved') {
        note(`~ department ${keyOf(row)}${moved ? ` -> ${k}` : ''}: "${row.name}"${row.name !== d.name ? ` -> "${d.name}"` : ''}${row.status !== 'Approved' ? ', approved' : ''}`);
        await tx.department.update({ where: { id: row.id }, data: { ...data, ...(row.status !== 'Approved' ? approved() : {}) } });
      }
    }

    // --- Positions -----------------------------------------------------------
    const positions = await tx.position.findMany({ include: { department: { include: { directorate: { select: { code: true } } } } } });
    const posClaimed = new Set();
    const posIds = new Map(); // workbook key -> position id
    // Earlier positions the workbook knows under another title or department.
    const moves = new Map();
    for (const p of positions) {
      const to = POSITION_MOVES[`${keyOf(p.department)}/${upper(p.name)}`];
      if (to) moves.set(to, p);
    }
    const moving = new Set([...moves.values()].map((p) => p.id));
    for (const [k, p] of target.positions) {
      const deptId = deptIds.get(p.deptKey);
      const inDept = positions.filter((x) => !posClaimed.has(x.id) && !moving.has(x.id) && x.departmentId === deptId);
      const row = moves.get(k) || inDept.find((x) => upper(x.code) === upper(p.code)) || inDept.find((x) => upper(x.name) === upper(p.name));
      const data = { code: p.code, name: p.name, level: p.level, departmentId: deptId };
      if (!row) {
        note(`+ position ${k} - ${p.name}`);
        posIds.set(k, (await tx.position.create({ data: { ...data, createdById: systemUser.id, ...approved() } })).id);
        continue;
      }
      posClaimed.add(row.id);
      posIds.set(k, row.id);
      const differs = row.code !== p.code || row.name !== p.name || row.level !== p.level || row.departmentId !== deptId;
      if (differs || row.status !== 'Approved') {
        note(`~ position ${keyOf(row.department)}/${row.code || '-'} "${row.name}" -> ${k} "${p.name}"`);
        await tx.position.update({ where: { id: row.id }, data: { ...data, ...(row.status !== 'Approved' ? approved() : {}) } });
      }
    }

    // --- What the workbook no longer has --------------------------------------
    const kept = [];
    const leftoverPositions = await tx.position.findMany({
      where: { id: { notIn: [...posClaimed, ...posIds.values()] } },
      include: { department: { include: { directorate: { select: { code: true } } } }, headOfDirectorate: { select: { id: true } }, _count: { select: { vacancies: true, vacanciesReportingHere: true } } }
    });
    for (const p of leftoverPositions) {
      const label = `position ${keyOf(p.department)}/${p.code || '-'} "${p.name}"`;
      if (p._count.vacancies || p._count.vacanciesReportingHere) {
        kept.push(`${label} - ${p._count.vacancies} vacancies, reports-to on ${p._count.vacanciesReportingHere}`);
      } else {
        note(`- ${label}`);
        if (p.headOfDirectorate) await tx.directorate.update({ where: { id: p.headOfDirectorate.id }, data: { headPositionId: null } });
        await tx.position.delete({ where: { id: p.id } });
      }
    }
    const leftoverDepartments = await tx.department.findMany({
      where: { id: { notIn: [...deptIds.values()] } },
      include: { directorate: { select: { code: true } }, _count: { select: { positions: true, vacancies: true, staff: true } } }
    });
    for (const d of leftoverDepartments) {
      const label = `department ${keyOf(d)} - ${d.name}`;
      if (d._count.vacancies || d._count.staff || d._count.positions) {
        kept.push(`${label} - ${d._count.positions} positions, ${d._count.vacancies} vacancies, ${d._count.staff} staff`);
      } else {
        note(`- ${label}`);
        await tx.department.delete({ where: { id: d.id } });
      }
    }
    const leftoverDirectorates = await tx.directorate.findMany({
      where: { code: { notIn: [...target.directorates.keys()] } },
      include: { _count: { select: { departments: true } } }
    });
    for (const d of leftoverDirectorates) {
      if (d._count.departments) kept.push(`directorate ${d.code} - ${d._count.departments} departments`);
      else { note(`- directorate ${d.code} - ${d.name}`); await tx.directorate.delete({ where: { id: d.id } }); }
    }

    // --- Heads --------------------------------------------------------------
    for (const [dirCode, posKey] of Object.entries(DIRECTORATE_HEADS)) {
      const directorate = dirByCode.get(dirCode);
      const headId = posIds.get(posKey);
      if (!directorate || !headId) continue;
      if (directorate.headPositionId !== headId) {
        note(`~ directorate ${dirCode}: head is ${posKey}`);
        await tx.directorate.update({ where: { id: directorate.id }, data: { headPositionId: headId } });
      }
    }
    return kept;
  };

  let kept;
  if (DRY_RUN) {
    // Run it for real inside a transaction and roll it back, so the plan is
    // exactly what applying it would do.
    try {
      await prisma.$transaction(async (tx) => { kept = await run(tx); throw Object.assign(new Error('rollback'), { rollback: true }); }, { timeout: 120000 });
    } catch (err) {
      if (!err.rollback) throw err;
    }
  } else {
    kept = await prisma.$transaction(run, { timeout: 120000 });
  }

  const count = (sign) => changes.filter((c) => c.startsWith(sign)).length;
  changes.filter((c) => !c.startsWith('+ position')).forEach((c) => log(c));
  log(`\n${count('+')} created (${count('+ position')} positions, not listed), ${count('~')} changed, ${count('-')} deleted${DRY_RUN ? ' - would be, on applying' : ''}.`);
  if (kept.length) {
    log('\nNot in the workbook, but in use, so kept - move or delete these on the Organisation pages:');
    kept.forEach((k) => log(`  ${k}`));
  }
  if (DRY_RUN) return { changes, kept };

  // Backfill departmentId onto staff accounts whose legacy department string
  // names exactly one approved department (prisma/seed.js's HR team: 'HR').
  let backfilled = 0;
  for (const s of await prisma.staffUser.findMany({ where: { departmentId: null } })) {
    const matches = await prisma.department.findMany({ where: { OR: [{ code: s.department }, { name: s.department }], status: 'Approved' } });
    if (matches.length === 1) {
      await prisma.staffUser.update({ where: { id: s.id }, data: { departmentId: matches[0].id } });
      backfilled++;
    }
  }
  if (backfilled) log(`\nLinked ${backfilled} staff account(s) to their department.`);
  return { changes, kept };
}

module.exports = { seed, DEPARTMENT_RENAMES, POSITION_MOVES };

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const fileArg = process.argv.indexOf('--file');
  seed({ prisma, dryRun: process.argv.includes('--dry-run'), file: fileArg > -1 ? process.argv[fileArg + 1] : DEFAULT_FILE })
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
