const { prisma, resetDatabase, createStaff, staffToken, api, expectStatus } = require('./helpers');
const { seed } = require('../scripts/seedDepartments');

// scripts/seedDepartments.js against the real schema: the earlier structure
// (as on UAT) is made to match UCAA's workbook in place - renamed and moved
// departments and positions keep their ids, the Director General's Office
// sits outside every directorate, what nothing uses is deleted, and running
// it again changes nothing.

const quiet = () => {};
let director;

async function oldStructure() {
  director = await createStaff('Director', 'dhra@caa.co.ug');
  const by = { createdById: director.id, status: 'Approved' };
  const corp = await prisma.directorate.create({ data: { code: 'CORP', name: 'CORP', createdById: director.id } });
  const daas = await prisma.directorate.create({ data: { code: 'DAAS', name: 'Airports and Aviation Security', createdById: director.id } });
  const dhra = await prisma.directorate.create({ data: { code: 'DHRA', name: 'Human Resource and Administration', createdById: director.id } });
  const dept = (code, name, directorateId) => prisma.department.create({ data: { code, name, directorateId, ...by } });
  const it = await dept('IT', 'Information Technology', corp.id);
  const mccs = await dept('MCCS', 'Marketing, Commercial and Customer Service', corp.id);
  const dgOffice = await dept('DG OFFICE', "Director General's Office", corp.id);
  const corpAffairs = await dept('CORP AFFAIRS', 'Corporate Affairs', corp.id);
  const gmOffice = await dept('GM OFFICE', "General Manager's Office", daas.id);
  const hr = await dept('HR', 'Human Resource', dhra.id);
  const pos = (code, name, departmentId, level) => prisma.position.create({ data: { code, name, departmentId, level, ...by } });
  return {
    corp, it, mccs, dgOffice, corpAffairs, gmOffice, hr,
    ictInno: await pos('ICT INNO', 'ICT INNOVATION OFFICER', it.id, 3),
    mmc: await pos('MMC', 'MANAGER MARKETING & COMMERCIAL', mccs.id, 7),
    ddg: await pos('DDG', 'DEPUTY DIRECTOR GENERAL', dgOffice.id, 8),
    // A staff account keeps GM OFFICE (not in the workbook) in use.
    gmStaff: await prisma.staffUser.update({
      where: { id: (await createStaff('HR_Officer', 'gm.pa@caa.co.ug')).id }, data: { department: 'GM OFFICE', departmentId: gmOffice.id }
    })
  };
}

beforeEach(async () => {
  await resetDatabase();
});

test('a dry run says what it would change and changes nothing', async () => {
  await oldStructure();
  const before = await Promise.all([prisma.department.count(), prisma.position.count()]);
  const { changes } = await seed({ prisma, dryRun: true, log: quiet });

  expect(changes).toEqual(expect.arrayContaining([
    "~ department CORP/DG OFFICE -> /DGO: \"Director General's Office\"",
    '- department CORP/CORP AFFAIRS - Corporate Affairs'
  ]));
  expect(await Promise.all([prisma.department.count(), prisma.position.count()])).toEqual(before);
  expect((await prisma.directorate.findUnique({ where: { code: 'CORP' } })).name).toBe('CORP');
});

test('the earlier structure is carried over in place, and a second run changes nothing', async () => {
  const old = await oldStructure();
  const { kept } = await seed({ prisma, log: quiet });

  // Directorates: the workbook's seven, Corporate named and headed by the DDG.
  const corp = await prisma.directorate.findUnique({ where: { code: 'CORP' } });
  expect(corp).toEqual(expect.objectContaining({ id: old.corp.id, name: 'Corporate', headPositionId: old.ddg.id }));
  expect((await prisma.directorate.findMany()).map((d) => d.code).sort()).toEqual(['CORP', 'DAAS', 'DANS', 'DF', 'DHRA', 'DSSER']);

  // Departments renamed in place; the DG's Office outside every directorate.
  const dgo = await prisma.department.findUnique({ where: { id: old.dgOffice.id } });
  expect(dgo).toEqual(expect.objectContaining({ code: 'DGO', name: "Director General's Office", directorateId: null }));
  expect(await prisma.department.findUnique({ where: { id: old.mccs.id } })).toEqual(expect.objectContaining({ code: 'MCS', name: 'Marketing & Commercial Services', directorateId: corp.id }));
  expect(await prisma.department.findUnique({ where: { id: old.corpAffairs.id } })).toBeNull();
  expect(kept).toEqual([expect.stringMatching(/^department DAAS\/GM OFFICE .* 1 staff$/)]);

  // Positions moved onto the workbook's, keeping their ids.
  const ddgo = await prisma.department.findFirst({ where: { code: 'DDGO', directorateId: corp.id } });
  expect(await prisma.position.findUnique({ where: { id: old.ddg.id } })).toEqual(expect.objectContaining({ code: 'DDG', name: 'Deputy Director General', departmentId: ddgo.id, level: 8 }));
  expect(await prisma.position.findUnique({ where: { id: old.mmc.id } })).toEqual(expect.objectContaining({ code: 'MMCCS', name: 'Manager Marketing, Commercial & Customer Services', departmentId: old.mccs.id }));
  expect(await prisma.position.findUnique({ where: { id: old.ictInno.id } })).toEqual(expect.objectContaining({ code: 'ICTIO', name: 'ICT Innovations Officer' }));
  expect(await prisma.position.count()).toBe(514);
  expect(await prisma.position.count({ where: { status: { not: 'Approved' } } })).toBe(0);
  const dg = await prisma.position.findFirst({ where: { code: 'DG' }, include: { department: true } });
  expect(dg).toEqual(expect.objectContaining({ name: 'Director General', level: 8, departmentId: dgo.id }));

  // The HR team's account (department 'HR') is linked to DHRA's HR.
  expect((await prisma.staffUser.findUnique({ where: { id: director.id } })).departmentId).toBe(old.hr.id);

  const again = await seed({ prisma, log: quiet });
  expect(again.changes).toEqual([]);
});

test('positions in the Director General\'s Office are usable on a vacancy, and the Senior Officer there reports to the DG', async () => {
  await oldStructure();
  await seed({ prisma, log: quiet });
  const hro = await createStaff('HR_Officer', 'hro@caa.co.ug');
  const token = await staffToken(hro.email);

  const usable = expectStatus(await api(token).get('/api/positions'), 200).body;
  const sodgo = usable.find((p) => p.code === 'SODGO');
  expect(sodgo).toEqual(expect.objectContaining({ department: expect.objectContaining({ code: 'DGO', directorate: null }) }));
  const departments = expectStatus(await api(token).get('/api/departments/approved'), 200).body;
  expect(departments.some((d) => d.code === 'DGO' && d.directorate === null)).toBe(true);

  const dg = usable.find((p) => p.code === 'DG');
  const senior = expectStatus(await api(token).get(`/api/positions/${sodgo.id}/senior-options`), 200).body;
  const options = senior.options || senior;
  expect(options.map((o) => o.id)).toEqual([dg.id]);
});
