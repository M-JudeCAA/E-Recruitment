const { parseRequisitionText, parseDate, parseDeadlineText } = require('../src/utils/requisitionParser');

// UCAA's job advertisement layout (the Manager Marketing & Commercial
// advert, shortened): labelled facts, the job purpose, the JD table of
// principal accountabilities - numbered titles, each with bulleted specific
// activities - the person specification, then how to apply, contacts, the
// closing date and the signature block. As the PDF extracts it (Word's
// arrow bullets as U+F0D8, a title and its first activity run together)
// and as the Word document does (no numbers or bullets, one paragraph per
// line).
const B = '';
const PDF_TEXT = `1
UGANDA CIVIL AVIATION AUHORITY
INTERNAL JOB ADVERTISEMENT
Applications are invited from suitably qualified employees of Uganda Civil Aviation
Authority to fill the following vacant position in the Corporate Division, as detailed below
JOB REF : UCAA/ADV/INT/O6/2026
POSITION : MANAGER MARKETING & COMMERCIAL
REPORTS TO : DEPUTY DIRECTOR GENERAL
SALARY LEVEL : 13
VACANCIES : 01
JOB PURPOSE : The position exists to lead in the marketing and
commercialization of UCAA and to create opportunities for the
growth of UCAA's aeronautical revenues
PRINCIPAL ACCOUNTABILITIES   SPECIFIC ACTIVITIES
1. Input into Strategic Planning
and Vision
${B} Understands the focus and direction of UCAA and fully
integrates the department.
${B} Participates in the business planning, budgeting, and
review process of the Authority.
2
2. Marketing and Commercial
Development and Management
${B} Develops and manages commercial concessions and
ensures adequate return on investment for the Authority.
${B} Organizes sensitization workshops for exporters to market
UCAA facilities and understands exporters' facility needs.
Develops action policies for UCAA response to make the
facilities more appealing to exporters.
3. Financial Management ${B} Understands the financial requirement of the department
and seeks approvals of the resources required.
${B} Monitors actual costs against expenditure on an ongoing
basis and reports accordingly.
4. Customer Service Builds a strong customer relationship management
strategy to ensure customer satisfaction.
6. Human Resource
Management
${B} Attracts, retains, develops, mentors, and motivates
high caliber staff in the department.
PERSON SPECIFICATIONS
Essential Requirements
1. A Master's degree in marketing, MBA, or any related field from an
approved, recognized, and reputable university or institution.
2. Membership to the Charted Institute of Marketing or equivalent
professional membership is required.
Desirable requirements
Brand Marketing, customer service, property management
and contract negotiations.
Knowledge
General knowledge about Transport Industry would be an added advantage.
SPECIAL SKILLS AND ATTRIBUTES
1. Must possess outstanding negotiating skills
2. Must be a seasoned People Manager with demonstrable prior experience and success in overseeing
Staff productivity and Performance Management.
HOW TO APPLY: -
1. If you meet the minimum requirements, please submit an updated CV
2. Submit the complete application to the recruitment email: recruitment@caa.co.ug
For any inquiries or assistance, please contact: -
Mr. A Person – PHRO @ TEL: 0772000000
6
Applications are to be received not later than 5:00pm, 29
TH
May 2026.
It is the duty of the applicant to ensure that his/her application is received by the indicated
We pledge to conduct a transparent recruitment process!
The Director Human Resource & Administration,
Uganda Civil Aviation Authority (Head Office)`;

const DOCX_TEXT = `UGANDA CIVIL AVIATION AUHORITY
INTERNAL JOB ADVERTISEMENT
Applications are invited from suitably qualified employees of Uganda Civil Aviation Authority to fill the following vacant position in the Corporate Division, as detailed below
JOB REF : UCAA/ADV/INT/O6/2026
POSITION : MANAGER MARKETING & COMMERCIAL
REPORTS TO : DEPUTY DIRECTOR GENERAL
SALARY LEVEL : 13
VACANCIES : 01
JOB PURPOSE : The position exists to lead in the marketing and
commercialization of UCAA and to create opportunities for the growth of UCAA's aeronautical revenues
PRINCIPAL ACCOUNTABILITIES
SPECIFIC ACTIVITIES
Input into Strategic Planning and Vision
Understands the focus and direction of UCAA and fully integrates the department.
Participates in the business planning, budgeting, and review process of the Authority.
Marketing and Commercial Development and Management
Develops and manages commercial concessions and ensures adequate return on investment for the Authority.
Organizes sensitization workshops for exporters to market UCAA facilities and understands exporters' facility needs. Develops action policies for UCAA response to make the facilities more appealing to exporters.
Financial Management
Understands the financial requirement of the department and seeks approvals of the resources required.
Monitors actual costs against expenditure on an ongoing basis and reports accordingly.
Customer Service
Builds a strong customer relationship management strategy to ensure customer satisfaction.
Human Resource Management
Attracts, retains, develops, mentors, and motivates high caliber staff in the department.
PERSON SPECIFICATIONS
Essential Requirements
A Master's degree in marketing, MBA, or any related field from an approved, recognized, and reputable university or institution.
Membership to the Charted Institute of Marketing or equivalent professional membership is required.
Desirable requirements
Brand Marketing, customer service, property management
and contract negotiations.
Knowledge
General knowledge about Transport Industry would be an added advantage.
SPECIAL SKILLS AND ATTRIBUTES
Must possess outstanding negotiating skills
Must be a seasoned People Manager with demonstrable prior experience and success in overseeing Staff productivity and Performance Management.
HOW TO APPLY: -
If you meet the minimum requirements, please submit an updated CV
For any inquiries or assistance, please contact: -
Applications are to be received not later than 5:00pm, 29TH May 2026.
We pledge to conduct a transparent recruitment process!`;

describe.each([['PDF', PDF_TEXT, 'pdf'], ['Word', DOCX_TEXT, 'docx']])('a job advertisement (%s)', (_, text, format) => {
  const parsed = parseRequisitionText(text, { format });
  const f = parsed.fields;

  test('reads the labelled facts, reports-to included', () => {
    expect(f.jobTitle.value).toBe('MANAGER MARKETING & COMMERCIAL');
    expect(f.reportsTo).toEqual(expect.objectContaining({ value: 'DEPUTY DIRECTOR GENERAL', confidence: 'high' }));
    expect(f.salaryScale.value).toBe('13');
    expect(f.vacancies.value).toBe(1);
  });

  test('reads what it says in prose: the directorate, Internal, and the closing date', () => {
    expect(f.directorate).toEqual(expect.objectContaining({ value: 'Corporate', confidence: 'medium' }));
    expect(f.advertType.value).toBe('Internal');
    expect(f.deadline.value).toBe('2026-05-29T17:00');
  });

  test('the job purpose stops at the accountabilities table', () => {
    expect(f.jobPurpose.value).toEqual([
      "The position exists to lead in the marketing and commercialization of UCAA and to create opportunities for the growth of UCAA's aeronautical revenues"
    ]);
  });

  test('reads each principal accountability with its specific activities', () => {
    expect(f.principalAccountabilities.groups.map((g) => [g.heading, g.items.length])).toEqual([
      ['Input into Strategic Planning and Vision', 2],
      ['Marketing and Commercial Development and Management', 2],
      ['Financial Management', 2],
      ['Customer Service', 1],
      ['Human Resource Management', 1]
    ]);
    const marketing = f.principalAccountabilities.groups[1].items;
    expect(marketing[1]).toBe("Organizes sensitization workshops for exporters to market UCAA facilities and understands exporters' facility needs. "
      + 'Develops action policies for UCAA response to make the facilities more appealing to exporters.');
    expect(f.principalAccountabilities.groups[2].items[0]).toBe('Understands the financial requirement of the department and seeks approvals of the resources required.');
    expect(f.principalAccountabilities.groups[3].items[0]).toMatch(/^Builds a strong customer/);
    expect(f.principalAccountabilities.value).toHaveLength(8);
    expect(f.principalAccountabilities.value).not.toContain('SPECIFIC ACTIVITIES');
  });

  test('rejoins wrapped lines in the person specification', () => {
    expect(f.essential.value).toHaveLength(2);
    expect(f.desirable.value).toEqual(['Brand Marketing, customer service, property management and contract negotiations.']);
    expect(f.knowledge.value).toEqual(['General knowledge about Transport Industry would be an added advantage.']);
  });

  test('special skills stop at "How to apply" - nothing from the closing part is read', () => {
    expect(f.specialSkills.value).toEqual([
      'Must possess outstanding negotiating skills',
      'Must be a seasoned People Manager with demonstrable prior experience and success in overseeing Staff productivity and Performance Management.'
    ]);
  });
});

describe('parseDate', () => {
  test.each([
    ['5:00pm, 29TH May 2026', '2026-05-29'],
    ['29 May, 2026', '2026-05-29'],
    ['May 29th, 2026', '2026-05-29'],
    ['1st Sept 2026', '2026-09-01'],
    ['29/05/2026', '2026-05-29']
  ])('reads %s', (text, expected) => expect(parseDate(text)).toBe(expected));

  test('a closing date keeps its time when one is given', () => {
    expect(parseDeadlineText('5:00pm, 29 TH May 2026')).toBe('2026-05-29T17:00');
    expect(parseDeadlineText('4.30 p.m. on 3rd June 2026')).toBe('2026-06-03T16:30');
    expect(parseDeadlineText('17:00 hrs, 1 July 2026')).toBe('2026-07-01T17:00');
    expect(parseDeadlineText('10am, 2 July 2026')).toBe('2026-07-02T10:00');
    expect(parseDeadlineText('29 May 2026')).toBe('2026-05-29');
  });

  test('refuses what is not a date', () => {
    expect(parseDate('31 February 2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
});
