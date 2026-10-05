const { parseRequisitionText } = require('../src/utils/requisitionParser');
const { extractDocumentText, DOCX_MIME, PDF_MIME } = require('../src/utils/documentText');
const { buildRequisitionDocx, buildRequisitionPdf, buildScannedPdf, DEFAULT_SPEC } = require('../scripts/lib/requisitionDocument');

const values = (parsed) => Object.fromEntries(Object.entries(parsed.fields).map(([k, f]) => [k, f.value]));

describe('reading a whole requisition', () => {
  test.each([
    ['Word', async () => extractDocumentText(await buildRequisitionDocx(), DOCX_MIME)],
    ['PDF', async () => extractDocumentText(buildRequisitionPdf(), PDF_MIME)]
  ])('reads every job detail from a %s requisition', async (_, load) => {
    const { text, format } = await load();
    const parsed = parseRequisitionText(text, { format });

    expect(parsed.missing).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(values(parsed)).toEqual(expect.objectContaining({
      jobTitle: 'HR Analyst', directorate: 'Corporate Affairs', department: 'Human Resources', section: 'Recruitment',
      reportsTo: 'Manager Human Resources', directReports: 'None', salaryScale: 'U5', vacancies: 2,
      advertType: 'External', contractType: 'FullTime', positionStatus: 'New', jdStatus: 'Approved',
      expectedReportingDate: '1 December 2026', equipment: 'Laptop, office desk', contractDuration: 'N/A',
      age: { minimumAge: null, maximumAge: 40 }, excoReference: 'EXCO MIN 42/2026', approvalDate: '25 September 2026',
      duties: DEFAULT_SPEC.duties, knowledge: DEFAULT_SPEC.knowledge
    }));
    expect(parsed.fields.essential.value).toHaveLength(2);
    expect(parsed.fields.specialSkills.value).toHaveLength(2);
    expect(parsed.fields.jobPurpose.value[0]).toMatch(/^To support the recruitment/);
  });

  test('keeps the raw wording of an interpreted value and marks it medium confidence', () => {
    const parsed = parseRequisitionText('Contract Type: Permanent and Pensionable');
    expect(parsed.fields.contractType).toEqual({
      value: 'FullTime', raw: 'Permanent and Pensionable', confidence: 'medium', label: 'Contract type'
    });
  });
});

describe('layouts', () => {
  test('a two-column table: the label on one line, its value on the next', () => {
    const parsed = parseRequisitionText('Job Title\nSenior Accountant\nReports To\nPrincipal Accountant\nNo. of Vacancies\n1');
    expect(values(parsed)).toEqual(expect.objectContaining({ jobTitle: 'Senior Accountant', reportsTo: 'Principal Accountant', vacancies: 1 }));
    expect(parsed.fields.jobTitle.confidence).toBe('high');
  });

  test('a label with no value next to it is not given the next label as its value', () => {
    const parsed = parseRequisitionText('Reports To\nSalary Scale\nU4');
    expect(parsed.fields.reportsTo).toBeUndefined();
    expect(parsed.fields.salaryScale.value).toBe('U4');
  });

  test('table cells a PDF export ran together are split, at medium confidence', () => {
    const parsed = parseRequisitionText('DepartmentFinance\nJob TitleSenior Accountant');
    expect(parsed.fields.department).toEqual(expect.objectContaining({ value: 'Finance', confidence: 'medium' }));
    expect(parsed.fields.jobTitle.value).toBe('Senior Accountant');
  });

  test('ignores numbering, case and punctuation on headings and labels', () => {
    const text = '1. JOB PURPOSE:\nTo keep the books.\n2. KEY DUTIES & RESPONSIBILITIES\na) Prepare accounts.\nb) Reconcile ledgers.\n3.1 salary scale - U3';
    const parsed = parseRequisitionText(text);
    expect(parsed.fields.jobPurpose.value).toEqual(['To keep the books.']);
    expect(parsed.fields.duties.value).toEqual(['Prepare accounts.', 'Reconcile ledgers.']);
    expect(parsed.fields.salaryScale.value).toBe('U3');
  });

  test('a section with its text inline after the heading', () => {
    const parsed = parseRequisitionText('Job Purpose: To manage the airport fire service.');
    expect(parsed.fields.jobPurpose.value).toEqual(['To manage the airport fire service.']);
  });

  test('rejoins bullet items a PDF wrapped across lines, and marks the list medium confidence', () => {
    const text = 'Essential\n• A Bachelor\'s degree in Accounting or\nFinance from a recognised university.\n• CPA (U) certification and\nmembership of ICPAU.\n• Five years of experience.';
    const parsed = parseRequisitionText(text, { format: 'pdf' });
    expect(parsed.fields.essential).toEqual(expect.objectContaining({
      confidence: 'medium',
      value: [
        'A Bachelor\'s degree in Accounting or Finance from a recognised university.',
        'CPA (U) certification and membership of ICPAU.',
        'Five years of experience.'
      ]
    }));
  });

  test('in a Word document every paragraph is its own item, even without full stops', () => {
    const parsed = parseRequisitionText('Special Skills and Attributes\nIntegrity\nTeam player', { format: 'docx' });
    expect(parsed.fields.specialSkills.value).toEqual(['Integrity', 'Team player']);
  });

  test('a section ends at the signature block rather than swallowing it', () => {
    const parsed = parseRequisitionText('Knowledge\nAviation law.\nPART B: VALIDATION\nDirector\nSigned');
    expect(parsed.fields.knowledge.value).toEqual(['Aviation law.']);
  });
});

describe('interpreting values', () => {
  test.each([
    ['2', 2], ['Two (2)', 2], ['three', 3], ['04 positions', 4]
  ])('vacancies "%s" -> %p', (raw, expected) => {
    expect(parseRequisitionText(`No. of Vacancies: ${raw}`).fields.vacancies.value).toBe(expected);
  });

  test.each([
    ['Fixed Term Contract', 'FixedTermContract'], ['Contract (2 years)', 'Contract'], ['Full time', 'FullTime']
  ])('contract type "%s" -> %s', (raw, expected) => {
    expect(parseRequisitionText(`Contract Type: ${raw}`).fields.contractType.value).toBe(expected);
  });

  test.each([
    ['Not above 40 years', { minimumAge: null, maximumAge: 40 }],
    ['Between 25 and 40 years', { minimumAge: 25, maximumAge: 40 }],
    ['18 - 35 years', { minimumAge: 18, maximumAge: 35 }],
    ['At least 21 years', { minimumAge: 21, maximumAge: null }],
    ['Not below 18 and not above 35', { minimumAge: 18, maximumAge: 35 }]
  ])('age "%s"', (raw, expected) => {
    expect(parseRequisitionText(`Age: ${raw}`).fields.age.value).toEqual(expected);
  });

  test('advert type is read only when it is clearly one or the other', () => {
    expect(parseRequisitionText('Type of Advert: INTERNAL').fields.advertType.value).toBe('Internal');
    const both = parseRequisitionText('Type of Advert: Internal and External');
    expect(both.fields.advertType).toBeUndefined();
    expect(both.warnings.join(' ')).toMatch(/could not be read/);
  });
});

describe('checks for HR', () => {
  test('lists what the document does not state', () => {
    const parsed = parseRequisitionText('Job Title: Driver\nDepartment: Transport');
    expect(parsed.missing).toEqual(expect.arrayContaining(['reportsTo', 'salaryScale', 'jobPurpose', 'essential']));
    expect(parsed.missing).not.toContain('jobTitle');
  });

  test('flags two parts of the document that disagree, and uses the first', () => {
    const parsed = parseRequisitionText('Position: Fire Officer\nJob Title: Senior Fire Officer');
    expect(parsed.fields.jobTitle).toEqual(expect.objectContaining({ value: 'Fire Officer', confidence: 'medium' }));
    expect(parsed.warnings[0]).toMatch(/Job title differs/);
  });

  test('warns when no EXCO approval appears anywhere', () => {
    expect(parseRequisitionText('Job Title: Driver').warnings.join(' ')).toMatch(/No EXCO approval/);
    expect(parseRequisitionText('Job Title: Driver\nApproved by EXCO: MIN 3/2026').warnings).toEqual([]);
  });

  test('an implausibly long value for a short field is low confidence', () => {
    const parsed = parseRequisitionText(`Reports To: ${'x'.repeat(200)}`);
    expect(parsed.fields.reportsTo.confidence).toBe('low');
  });
});

describe('extractDocumentText', () => {
  test('refuses a scanned PDF - one with no text layer', async () => {
    await expect(extractDocumentText(buildScannedPdf(), PDF_MIME)).rejects.toMatchObject({ status: 422, code: 'SCANNED_DOCUMENT' });
  });

  test('refuses old .doc files and images', async () => {
    await expect(extractDocumentText(Buffer.from('x'), 'application/msword')).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCUMENT' });
    await expect(extractDocumentText(Buffer.from('x'), 'image/jpeg')).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCUMENT' });
  });

  test('reads a PDF that sits inside a larger buffer, as small uploads do in Node\'s shared pool', async () => {
    const pdf = buildRequisitionPdf();
    const slab = Buffer.alloc(pdf.length + 4096, 0x41);
    pdf.copy(slab, 2048);
    const view = slab.subarray(2048, 2048 + pdf.length);
    const { text } = await extractDocumentText(view, PDF_MIME);
    expect(text).toContain('JOB OPENING REQUEST');
  });

  test('refuses a file that is not really the type it claims', async () => {
    await expect(extractDocumentText(Buffer.from('not a pdf'), PDF_MIME)).rejects.toMatchObject({ code: 'UNREADABLE_DOCUMENT' });
  });
});
