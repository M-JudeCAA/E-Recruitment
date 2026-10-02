const fs = require('fs');
const os = require('os');
const path = require('path');

// requisitionService reads stored uploads from UPLOAD_DIR, fixed when the
// module loads - point it at a scratch folder first.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'requisition-test-'));
process.env.UPLOAD_DIR = uploadDir;

jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const requisitionService = require('../src/services/requisitionService');
const { buildRequisitionDocx, buildScannedPdf } = require('../scripts/lib/requisitionDocument');

const corporate = { id: 10, name: 'Corporate Affairs' };
const DEPARTMENTS = [
  { id: 1, name: 'Human Resources', directorate: corporate },
  { id: 2, name: 'CWG', directorate: corporate },
  { id: 3, name: 'CWG', directorate: { id: 20, name: 'Air Navigation Services' } }
];
const POSITIONS = [
  { id: 100, name: 'HR Analyst', departmentId: 1, level: 1 },
  { id: 101, name: 'Senior HR Officer', departmentId: 1, level: 2 },
  { id: 102, name: 'Manager Human Resources', departmentId: 1, level: 3 }
];

let n = 0;
async function store(buffer, ext = 'docx') {
  n += 1;
  const filename = `requisition-00000000-0000-0000-0000-${String(n).padStart(12, '0')}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), buffer);
  return { filename, originalname: 'Job Opening Request - HR Analyst.docx' };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.department.findMany.mockResolvedValue(DEPARTMENTS);
  prisma.position.findMany.mockImplementation(async ({ where }) => POSITIONS.filter((p) => p.departmentId === where.departmentId));
  prisma.vacancy.findFirst.mockResolvedValue(null);
});

afterAll(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

describe('read (step 1: upload and review)', () => {
  test('reads the document, matches the organogram and pre-fills the vacancy form', async () => {
    const file = await store(await buildRequisitionDocx());

    const result = await requisitionService.read(file);

    expect(result.document).toEqual(expect.objectContaining({ filename: file.filename, url: `/api/files/${file.filename}`, format: 'docx' }));
    expect(result.organogram).toEqual({
      department: { id: 1, name: 'Human Resources', directorate: 'Corporate Affairs', confidence: 'high' },
      position: { id: 100, name: 'HR Analyst', confidence: 'high' },
      reportsTo: { id: 102, name: 'Manager Human Resources', confidence: 'high' }
    });
    expect(result.prefill).toEqual(expect.objectContaining({
      departmentId: 1, positionId: 100, reportsToPositionId: 102, positionsRequired: 2, postingType: 'External',
      salaryScale: 'U5', location: 'UCAA Head Office — Entebbe', employmentCategory: 'FullTime', maximumAge: 40,
      essentialRequirements: expect.arrayContaining([expect.stringMatching(/^A Bachelor's degree/)]),
      desirableQualifications: ['Membership of the Human Resource Managers Association of Uganda.'],
      generalKnowledge: ['Knowledge of the Employment Act, 2006.']
    }));
    expect(result.prefill.jobPurpose).toMatch(/^<p>To support the recruitment.*<p><strong>Principal Accountabilities<\/strong><\/p><ul><li>/);
    expect(result.prefill.jobPurpose).toContain('<strong>Duties and Responsibilities</strong>');
    // Screening is never pre-filled - HR adds it.
    expect(result.prefill).not.toHaveProperty('minimumEducationLevel');
    expect(result.prefill).not.toHaveProperty('disqualifyingRequirements');
    expect(result.warnings).toEqual([]);
  });

  test('refuses a scanned document and deletes the stored copy', async () => {
    const file = await store(buildScannedPdf(), 'pdf');
    await expect(requisitionService.read(file)).rejects.toMatchObject({ status: 422, code: 'SCANNED_DOCUMENT' });
    await new Promise((r) => setTimeout(r, 20));
    expect(fs.existsSync(path.join(uploadDir, file.filename))).toBe(false);
  });

  test('refuses a requisition that already opened a vacancy, naming it', async () => {
    prisma.vacancy.findFirst.mockResolvedValue({ id: 5, jobRef: 'UCAA/ADV/EXT/003/2026', title: 'HR Analyst', status: 'Open' });
    const file = await store(await buildRequisitionDocx());

    await expect(requisitionService.read(file)).rejects.toMatchObject({
      status: 409, code: 'DUPLICATE_REQUISITION', existing: expect.objectContaining({ jobRef: 'UCAA/ADV/EXT/003/2026' })
    });
    expect(prisma.vacancy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { requisitionDocumentHash: expect.stringMatching(/^[0-9a-f]{64}$/) }
    }));
  });
});

describe('organogram matching', () => {
  test('a department name that recurs is settled by the directorate the document names', async () => {
    const result = await requisitionService.matchOrganogram({
      directorate: { value: 'Air Navigation Services' }, department: { value: 'CWG' }, jobTitle: { value: 'Nobody' }
    });
    expect(result.department).toEqual(expect.objectContaining({ id: 3 }));
  });

  test('a recurring department name with no directorate to settle it is left for HR', async () => {
    const result = await requisitionService.matchOrganogram({ department: { value: 'CWG' } });
    expect(result.department).toBeNull();
    expect(result.warnings[0]).toMatch(/more than one entry/);
  });

  test('a name containing the organogram name is a medium-confidence match', async () => {
    const result = await requisitionService.matchOrganogram({
      department: { value: 'Human Resources Department' }, jobTitle: { value: 'HR Analyst' }
    });
    expect(result.department).toEqual(expect.objectContaining({ id: 1, confidence: 'medium' }));
  });

  test('a job title not on the organogram is reported, and reports-to is only matched among senior positions', async () => {
    const missing = await requisitionService.matchOrganogram({ department: { value: 'Human Resources' }, jobTitle: { value: 'Payroll Clerk' } });
    expect(missing.position).toBeNull();
    expect(missing.warnings[0]).toMatch(/Payroll Clerk.*not on the organogram/);

    const junior = await requisitionService.matchOrganogram({
      department: { value: 'Human Resources' }, jobTitle: { value: 'Senior HR Officer' }, reportsTo: { value: 'HR Analyst' }
    });
    expect(junior.reportsTo).toBeNull();
  });
});

describe('forCreate (step 2: creating the vacancy)', () => {
  test('needs the uploaded document and HR\'s confirmation of the EXCO approval', async () => {
    await expect(requisitionService.forCreate({}, 1)).rejects.toMatchObject({ code: 'REQUISITION_REQUIRED' });
    const file = await store(await buildRequisitionDocx());
    await expect(requisitionService.forCreate({ requisitionDocument: { filename: file.filename } }, 1))
      .rejects.toMatchObject({ code: 'REQUISITION_NOT_CONFIRMED' });
  });

  test('accepts only a stored requisition upload, never another file or a path', async () => {
    for (const filename of ['../secrets.docx', 'some-cv.pdf', 'requisition-x.docx']) {
      await expect(requisitionService.forCreate({ requisitionDocument: { filename }, requisitionConfirmed: true }, 1))
        .rejects.toMatchObject({ status: 400 });
    }
    await expect(requisitionService.forCreate({
      requisitionDocument: { filename: 'requisition-99999999-9999-9999-9999-999999999999.docx' }, requisitionConfirmed: true
    }, 1)).rejects.toMatchObject({ status: 404 });
  });

  test('re-reads the document itself and records it, with the fields HR changed from it', async () => {
    const file = await store(await buildRequisitionDocx());
    const body = {
      requisitionDocument: { filename: file.filename, originalName: 'Job Opening Request.docx' }, requisitionConfirmed: true,
      // As read, except the salary scale and the number of vacancies.
      departmentId: '1', positionId: '100', positionsRequired: 3, postingType: 'External', salaryScale: 'U4',
      location: 'UCAA Head Office — Entebbe', employmentCategory: 'FullTime', maximumAge: '40'
    };

    const columns = await requisitionService.forCreate(body, 7);

    expect(columns).toEqual(expect.objectContaining({
      requisitionDocumentUrl: `/api/files/${file.filename}`, requisitionDocumentName: 'Job Opening Request.docx',
      requisitionDocumentHash: expect.stringMatching(/^[0-9a-f]{64}$/), requisitionUploadedById: 7
    }));
    expect(columns.requisitionDetails.fields.jobTitle.value).toBe('HR Analyst');
    expect(columns.requisitionDetails.editedFields).toEqual(['positionsRequired', 'salaryScale']);
  });
});

describe('editedFields', () => {
  const prefill = { positionId: 100, jobPurpose: '<p>To keep the books.</p><ul><li>Pay staff.</li></ul>', specialSkills: ['Integrity'] };

  test('compares rich text by its words, not its markup', () => {
    expect(requisitionService.editedFields(prefill, { jobPurpose: '<p>To keep the books. </p>\n<ul>\n<li>Pay staff.</li></ul>' })).toEqual([]);
    expect(requisitionService.editedFields(prefill, { jobPurpose: '<p>To keep the books.</p>' })).toEqual(['jobPurpose']);
  });

  test('a field the form did not send is not a change; clearing one is', () => {
    expect(requisitionService.editedFields(prefill, { positionId: '100' })).toEqual([]);
    expect(requisitionService.editedFields(prefill, { specialSkills: [] })).toEqual(['specialSkills']);
  });
});
