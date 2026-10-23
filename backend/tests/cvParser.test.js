const JSZip = require('jszip');
const { extractText, htmlToLines } = require('../src/utils/cvParser');
const { extractFieldsFromText } = require('../src/utils/cvHeuristics');
const { buildPdf, escapePdfText } = require('../scripts/lib/requisitionDocument');

// Getting a CV's text out in reading order, whatever its layout.

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// A PDF page with text placed at [x, y].
const placed = (items) => buildPdf([items.map(([x, y, text]) => `BT /F1 10 Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`).join('\n')]);

describe('PDF', () => {
  // A sidebar (contacts, skills) beside the main column, their lines level
  // with each other - read line by line they would be interleaved.
  const twoColumns = placed([
    [40, 800, 'GRACE NAMULONDO'],
    [40, 760, 'CONTACT'], [230, 760, 'WORK EXPERIENCE'],
    [40, 745, 'grace.n@gmail.com'], [230, 745, 'Procurement Officer'], [470, 745, 'Feb 2020 - Present'],
    [40, 730, '0772 555111'], [230, 730, 'Uganda National Roads Authority'],
    [40, 715, 'SKILLS'], [230, 715, '- Managed tenders for road works'],
    [40, 700, 'Negotiation'], [230, 700, '- Kept the procurement plan'],
    [40, 685, 'Contract law'], [230, 670, 'EDUCATION'],
    [40, 670, 'Excel'], [230, 655, 'Bachelor of Procurement and Logistics Management'],
    [40, 655, 'Teamwork'], [230, 640, 'Kyambogo University, 2018']
  ]);

  test('reads a two-column page one column at a time', async () => {
    const text = await extractText(twoColumns, PDF);
    const lines = text.split('\n').filter(Boolean);
    const at = (s) => lines.findIndex((l) => l.includes(s));
    // The main column's lines stay together, in order...
    expect(at('Procurement Officer')).toBe(at('WORK EXPERIENCE') + 1);
    expect(at('Uganda National Roads Authority')).toBe(at('Procurement Officer') + 1);
    expect(at('Bachelor of Procurement')).toBe(at('EDUCATION') + 1);
    // ...and the sidebar's never lands between them.
    expect(at('Negotiation')).toBeGreaterThan(at('Kyambogo University'));
    // A date pushed to the right margin stays on its line, set apart.
    expect(lines[at('Procurement Officer')]).toBe('Procurement Officer | Feb 2020 - Present');
  });

  test('and the details come out right', async () => {
    const r = extractFieldsFromText(await extractText(twoColumns, PDF));
    expect(r.workExperience).toEqual([expect.objectContaining({
      jobTitle: 'Procurement Officer', employer: 'Uganda National Roads Authority', startDate: '2020-02-01', endDate: '',
      duties: ['Managed tenders for road works', 'Kept the procurement plan']
    })]);
    expect(r.education).toEqual([expect.objectContaining({
      qualificationLevel: 'Bachelors', fieldOfStudy: 'Procurement and Logistics Management', institution: 'Kyambogo University', yearCompleted: 2018
    })]);
    expect(r).toEqual(expect.objectContaining({ email: 'grace.n@gmail.com', phone: '0772 555111', fullName: 'Grace Namulondo' }));
  });

  test('a single-column page is read top to bottom', async () => {
    const text = await extractText(placed([[40, 800, 'EDUCATION'], [40, 785, 'Diploma in Aircraft Maintenance'], [40, 770, 'East African School of Aviation, 2015']]), PDF);
    expect(text.split('\n').filter(Boolean)).toEqual(['EDUCATION', 'Diploma in Aircraft Maintenance', 'East African School of Aviation, 2015']);
  });
});

describe('Word', () => {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const table = (rows) => `<w:tbl>${rows.map((cells) => `<w:tr>${cells.map((c) => `<w:tc>${[].concat(c).map(p).join('')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  async function docx(body) {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  test('keeps a table row together, its cells apart', async () => {
    const file = await docx(p('ACADEMIC QUALIFICATIONS') + table([
      ['Period', 'Institution', 'Award'],
      ['2014 - 2017', 'Makerere University Business School', 'Bachelor of Commerce'],
      ['2012 - 2013', ['Uganda Institute of', 'Information and Communications Technology'], 'Certificate in Computer Science']
    ]) + p('EMPLOYMENT HISTORY') + table([
      ['Period', 'Organisation', 'Position'],
      ['2018 - Present', 'Bank of Uganda', 'Accounts Officer']
    ]));
    const text = await extractText(file, DOCX);
    expect(text).toMatch(/^2014 - 2017 \| Makerere University Business School \| Bachelor of Commerce$/m);

    const r = extractFieldsFromText(text);
    expect(r.education.map((e) => [e.qualificationLevel, e.fieldOfStudy, e.institution, e.yearCompleted])).toEqual([
      ['Bachelors', 'Commerce', 'Makerere University Business School', 2017],
      ['Certificate', 'Computer Science', 'Uganda Institute of / Information and Communications Technology', 2013]
    ]);
    expect(r.workExperience).toEqual([expect.objectContaining({ employer: 'Bank of Uganda', jobTitle: 'Accounts Officer', startDate: '2018-01-01', endDate: '' })]);
  });

  test('list items become bullets and headings start a block', () => {
    expect(htmlToLines('<h2>Skills</h2><ul><li>Excel</li><li>Driving &amp; first aid</li></ul><p>Done</p>'))
      .toBe('\nSkills\n• Excel\n• Driving & first aid\nDone');
  });
});
