jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const reportingLines = require('../src/services/reportingLineService');

beforeEach(() => jest.clearAllMocks());

// DHRA: a Director in the Director's Office, a Manager and an Officer in
// Human Resources, an Officer in the Director's Office, a Manager in
// Administration.
// CORP: the DG and the DDG in the DG Office, the DDG named as head; a
// Manager in IT.
const dirOffice = { id: 1, code: 'DIR OFFICE', name: "Director's Office - HRA", directorateId: 10 };
const hr = { id: 2, code: 'HR', name: 'Human Resources', directorateId: 10 };
const dgOffice = { id: 3, code: 'DG OFFICE', name: "Director General's Office", directorateId: 20 };
const it = { id: 4, code: 'IT', name: 'Information Technology', directorateId: 20 };
const admin = { id: 5, code: 'ADMIN', name: 'Administration', directorateId: 10 };
const dhra = { id: 10, code: 'DHRA', headPositionId: null };
const corp = { id: 20, code: 'CORP', headPositionId: 300 };

const P = {
  director: { id: 100, name: 'Director HRA', departmentId: 1, level: 8, status: 'Approved', department: dirOffice },
  officeOfficer: { id: 101, name: 'Executive Assistant', departmentId: 1, level: 3, status: 'Approved', department: dirOffice },
  hrManager: { id: 200, name: 'Manager Human Resources', departmentId: 2, level: 7, status: 'Approved', department: hr },
  hrOfficer: { id: 201, name: 'HR Officer', departmentId: 2, level: 3, status: 'Approved', department: hr },
  adminManager: { id: 500, name: 'Manager Administration', departmentId: 5, level: 7, status: 'Approved', department: admin },
  dg: { id: 301, code: 'DG', name: 'Director General', departmentId: 3, level: 8, status: 'Approved', department: dgOffice },
  ddg: { id: 300, name: 'Deputy Director General', departmentId: 3, level: 8, status: 'Approved', department: dgOffice },
  dgOfficer: { id: 302, name: 'Personal Assistant', departmentId: 3, level: 3, status: 'Approved', department: dgOffice },
  itManager: { id: 400, name: 'Manager IT', departmentId: 4, level: 7, status: 'Approved', department: it }
};
const ALL = Object.values(P);
const DIRECTORATES = { 10: dhra, 20: corp };

// position.findUnique / findMany as the database would answer the queries
// reportingLineService makes.
function mockDatabase() {
  prisma.position.findUnique.mockImplementation(async ({ where }) => ALL.find((p) => p.id === where.id) || null);
  prisma.position.findMany.mockImplementation(async ({ where }) => ALL.filter((p) => p.status === 'Approved'
    && (where.departmentId === undefined
      || (typeof where.departmentId === 'object' ? p.departmentId !== where.departmentId.not : p.departmentId === where.departmentId))
    && (where.department?.directorateId === undefined || p.department.directorateId === where.department.directorateId)
    && (where.level === undefined || (typeof where.level === 'number' ? p.level === where.level : p.level > where.level.gt))
    && (!where.OR || where.OR.some((c) => (c.code && p.code === c.code) || (c.name && p.name.includes(c.name.contains))))));
}
const withDirectorate = (p) => ({ ...p, department: { ...p.department, directorate: DIRECTORATES[p.department.directorateId] } });
const ids = (options) => options.map((o) => o.id);

describe('optionsFor', () => {
  beforeEach(mockDatabase);

  test('a Manager reports to the Director of the directorate, in the Director\'s Office', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.hrManager));
    expect(ids(options)).toEqual([100]);
    expect(options[0]).toEqual(expect.objectContaining({ directorateHead: true, outsideDepartment: true }));
    expect(suggestedId).toBe(100);
  });

  test('an officer in the Director\'s Office reports to the Director directly', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.officeOfficer));
    expect(ids(options)).toEqual([100]);
    expect(options[0].outsideDepartment).toBe(false);
    expect(suggestedId).toBe(100);
  });

  test('an officer in a department has those more senior in it and the directorate head - nobody from another department - and no suggestion', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.hrOfficer));
    expect(ids(options)).toEqual([200, 100]);
    expect(ids(options)).not.toContain(500);
    expect(suggestedId).toBeNull();
  });

  test('a Chief reports to someone more senior in the department, like a Principal - only a Manager is pointed at the directorate head', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate({ ...P.hrOfficer, id: 203, name: 'Chief HR Officer', level: 6 }));
    expect(ids(options)).toEqual([200, 100]);
    expect(suggestedId).toBeNull();
  });

  test('in Corporate a Manager reports to the DDG, the head HR named; the DG in another department is not a choice', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.itManager));
    expect(ids(options)).toEqual([300]);
    expect(suggestedId).toBe(300);
  });

  test('an officer sees no one at its own level in its department', async () => {
    const { options } = await reportingLines.optionsFor(withDirectorate({ ...P.hrOfficer, id: 202, name: 'HR Assistant' }));
    expect(ids(options)).not.toContain(201);
  });

  test('in the DG Office the DG stays a choice, the DDG is suggested', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.dgOfficer));
    expect(ids(options)).toEqual(expect.arrayContaining([300, 301]));
    expect(options.find((o) => o.id === 300).directorateHead).toBe(true);
    expect(suggestedId).toBe(300);
  });

  test('a Director reports to the Director General', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.director));
    expect(ids(options)).toEqual([301]);
    expect(options[0]).toEqual(expect.objectContaining({ directorGeneral: true, outsideDepartment: true }));
    expect(suggestedId).toBe(301);
  });

  test('the DDG reports to the Director General', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.ddg));
    expect(ids(options)).toEqual([301]);
    expect(suggestedId).toBe(301);
  });

  test('the Director General reports to no one here', async () => {
    const { options, suggestedId } = await reportingLines.optionsFor(withDirectorate(P.dg));
    expect(options).toEqual([]);
    expect(suggestedId).toBeNull();
  });
});

describe('directorateHead and directorGeneral', () => {
  beforeEach(mockDatabase);

  test('with none named, the one Director-level position stands in', async () => {
    expect((await reportingLines.directorateHead(dhra)).id).toBe(100);
  });

  test('with none named and two Director-level positions (DG and DDG), there is no head', async () => {
    expect(await reportingLines.directorateHead({ ...corp, headPositionId: null })).toBeNull();
  });

  test('a named head that is no longer approved counts as none', async () => {
    prisma.position.findUnique.mockResolvedValue({ ...P.ddg, status: 'Rejected' });
    expect(await reportingLines.directorateHead(corp)).toBeNull();
  });

  test('the Director General is not the Deputy', async () => {
    expect((await reportingLines.directorGeneral()).id).toBe(301);
  });
});
