// Builds realistic, text-based requisition documents - the EXCO-approved Job
// Opening Request with its job description - as a Word (.docx) file or a
// PDF, for the e2e tests and the demo-data seeders. HR uploads one of these
// before a vacancy can be created (see services/requisitionService.js).
//
// The layout follows the UCAA template: Part A (job vacancy details) and
// Part B (validation/approval) as label | value tables, then the job
// description - its header table, then Job Purpose, Principal
// Accountabilities, Duties and Responsibilities and the Person
// Specification as headings with real Word bullet lists.
const JSZip = require('jszip');

const DEFAULT_SPEC = {
  directorate: 'Corporate Affairs',
  department: 'Human Resources',
  section: 'Recruitment',
  jobTitle: 'HR Analyst',
  station: 'UCAA Head Office — Entebbe',
  reportsTo: 'Manager Human Resources',
  directReports: 'None',
  advertType: 'External',
  vacancies: 2,
  salaryScale: 'U5',
  contractType: 'Permanent and Pensionable',
  contractDuration: 'N/A',
  positionStatus: 'New',
  jdStatus: 'Approved',
  expectedReportingDate: '1 December 2026',
  equipment: 'Laptop, office desk',
  age: 'Not above 40 years',
  excoMinute: 'EXCO MIN 42/2026',
  approvalDate: '25 September 2026',
  jobPurpose: 'To support the recruitment, selection and onboarding of staff in line with the Authority\'s human resource policies.',
  principalAccountabilities: [
    'Timely filling of approved vacant positions.',
    'Accurate and up-to-date recruitment records.'
  ],
  duties: [
    'Coordinate the advertisement of approved vacancies.',
    'Screen applications against the approved person specification.',
    'Organise shortlisting and interview logistics.'
  ],
  essential: [
    'A Bachelor\'s degree in Human Resource Management or a related field from a recognised institution.',
    'At least three (3) years of relevant working experience.'
  ],
  desirable: ['Membership of the Human Resource Managers Association of Uganda.'],
  knowledge: ['Knowledge of the Employment Act, 2006.'],
  specialSkills: ['Excellent interpersonal and communication skills.', 'High level of integrity.']
};

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The document as an ordered list of blocks, shared by both formats.
function blocks(spec) {
  return [
    { type: 'heading', text: 'UGANDA CIVIL AVIATION AUTHORITY' },
    { type: 'heading', text: 'JOB OPENING REQUEST' },
    { type: 'heading', text: 'PART A: JOB VACANCY DETAILS' },
    {
      type: 'table',
      rows: [
        ['Directorate', spec.directorate], ['Department', spec.department], ['Position', spec.jobTitle],
        ['Location', spec.station], ['Type of Advert', spec.advertType], ['No. of Vacancies', String(spec.vacancies)],
        ['JD Status', spec.jdStatus], ['Position Status', spec.positionStatus],
        ['Contract Type', spec.contractType], ['Contract Duration', spec.contractDuration],
        ['Expected Reporting Date', spec.expectedReportingDate], ['Salary Scale Level', spec.salaryScale],
        ['Age', spec.age], ['Required Items/Equipment', spec.equipment]
      ].filter(([, value]) => value != null && value !== '')
    },
    { type: 'heading', text: 'PART B: VALIDATION' },
    {
      type: 'table',
      rows: [
        ['Head of Department', 'Signed'], ['Director', 'Signed'], ['DHRA', 'Signed'],
        ['Approved by EXCO', spec.excoMinute], ['Date of Approval', spec.approvalDate]
      ].filter(([, value]) => value)
    },
    { type: 'heading', text: 'JOB DESCRIPTION' },
    {
      type: 'table',
      rows: [
        ['Job Title', spec.jobTitle], ['Department', spec.department], ['Section', spec.section],
        ['Station', spec.station], ['Reports To', spec.reportsTo], ['No. of Direct Reports', spec.directReports]
      ].filter(([, value]) => value)
    },
    { type: 'heading', text: 'Job Purpose' },
    { type: 'paragraph', text: spec.jobPurpose },
    { type: 'heading', text: 'Principal Accountabilities' },
    ...spec.principalAccountabilities.map((text) => ({ type: 'bullet', text })),
    { type: 'heading', text: 'Duties and Responsibilities' },
    ...spec.duties.map((text) => ({ type: 'bullet', text })),
    { type: 'heading', text: 'Person Specifications' },
    { type: 'heading', text: 'Essential' },
    ...spec.essential.map((text) => ({ type: 'bullet', text })),
    { type: 'heading', text: 'Desirable' },
    ...spec.desirable.map((text) => ({ type: 'bullet', text })),
    { type: 'heading', text: 'Knowledge' },
    ...spec.knowledge.map((text) => ({ type: 'bullet', text })),
    { type: 'heading', text: 'Special Skills and Attributes' },
    ...spec.specialSkills.map((text) => ({ type: 'bullet', text }))
  ];
}

function run(text, bold) {
  return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(text, { bold = false, bullet = false } = {}) {
  const props = bullet ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : '';
  return `<w:p>${props}${run(text, bold)}</w:p>`;
}

function docxBody(spec) {
  return blocks(spec).map((block) => {
    if (block.type === 'heading') return paragraph(block.text, { bold: true });
    if (block.type === 'paragraph') return paragraph(block.text);
    if (block.type === 'bullet') return paragraph(block.text, { bullet: true });
    const rows = block.rows.map(([label, value]) => (
      `<w:tr><w:tc>${paragraph(label, { bold: true })}</w:tc><w:tc>${paragraph(value)}</w:tc></w:tr>`
    )).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows}</w:tbl><w:p/>`;
  }).join('');
}

async function buildRequisitionDocx(overrides = {}) {
  const spec = { ...DEFAULT_SPEC, ...overrides };
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
    + '</Relationships>');
  zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}>`
    + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${docxBody(spec)}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// A minimal but valid text PDF: one line of text per block line, flowing
// onto as many A4 pages as needed. Table rows are written as "Label: Value",
// which is how a typical PDF export of the form reads once text is
// extracted.
function pdfLines(spec) {
  const lines = [];
  for (const block of blocks(spec)) {
    if (block.type === 'table') block.rows.forEach(([label, value]) => lines.push(`${label}: ${value}`));
    else if (block.type === 'bullet') lines.push(`• ${block.text}`);
    else lines.push(block.text);
  }
  return lines;
}

function escapePdfText(text) {
  // Standard 14 fonts use WinAnsi - keep to plain ASCII-ish text.
  return String(text).replace(/[—–]/g, '-').replace(/[’‘]/g, "'").replace(/•/g, '-')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(pageContents) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add(null);
  const pagesId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = pageContents.map((content) => {
    const streamId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const LINES_PER_PAGE = 48;

function buildRequisitionPdf(overrides = {}) {
  const spec = { ...DEFAULT_SPEC, ...overrides };
  const lines = pdfLines(spec);
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    const pageLines = lines.slice(i, i + LINES_PER_PAGE);
    pages.push(`BT /F1 9 Tf 40 800 Td 14 TL ${pageLines.map((l) => `(${escapePdfText(l)}) Tj T*`).join(' ')} ET`);
  }
  return buildPdf(pages);
}

// A "scanned" PDF: pages with only a drawn shape and no text layer, which
// is what a scanner produces - for the refusal path.
function buildScannedPdf(pageCount = 2) {
  return buildPdf(Array.from({ length: pageCount }, () => '0.5 g 40 400 515 400 re f'));
}

module.exports = { DEFAULT_SPEC, buildRequisitionDocx, buildRequisitionPdf, buildScannedPdf };
