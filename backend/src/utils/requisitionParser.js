// Reads the job details out of the text of an EXCO-approved requisition (the
// UCAA Job Opening Request with its job description) - see
// services/requisitionService.js. Pure text in, structured fields out, so
// it is tested without any files.
//
// The template is a set of labelled facts (Part A and the JD header, as
// "Label: value", or as a two-column table that extracts as the label on
// one line and the value on the next) followed by headed sections (Job
// Purpose, Principal Accountabilities, Duties and Responsibilities, Person
// Specifications: Essential / Desirable / Knowledge / Special Skills).
// Labels are matched against a list of the wordings seen on the form and
// its variants, ignoring case, punctuation and numbering.
//
// Every field comes back with a confidence:
//   high   - found under its own label, and read as-is
//   medium - found, but the value needed interpreting (e.g. "Permanent and
//            Pensionable" read as Full-time), two parts of the document
//            disagree, or wrapped PDF lines were rejoined
//   low    - found, but the value looks wrong for the field (e.g. far too long)
// and anything not found is listed in `missing`. Screening questions are
// never read from the document - HR adds them as before.

const SCALARS = {
  jobTitle: ['job title', 'position', 'position title', 'title of position', 'title of the position', 'job position', 'designation'],
  directorate: ['directorate'],
  department: ['department'],
  section: ['section', 'unit', 'section unit'],
  station: ['station', 'duty station', 'location', 'work station', 'work location'],
  reportsTo: ['reports to', 'reporting to', 'immediate supervisor', 'supervisor'],
  directReports: ['no of direct reports', 'number of direct reports', 'direct reports'],
  salaryScale: ['salary scale level', 'salary scale', 'salary level', 'salary grade', 'grade', 'scale'],
  vacancies: ['no of vacancies', 'number of vacancies', 'no of positions', 'number of positions', 'vacancies', 'number of posts', 'no of posts'],
  advertType: ['type of advert', 'advert type', 'type of advertisement', 'advertisement type'],
  contractType: ['contract type', 'type of contract', 'terms of employment', 'employment type', 'nature of employment'],
  contractDuration: ['contract duration', 'duration of contract', 'duration'],
  expectedReportingDate: ['expected reporting date', 'reporting date', 'expected date of reporting'],
  positionStatus: ['position status', 'status of position'],
  jdStatus: ['jd status', 'job description status'],
  age: ['age', 'age limit', 'age requirement'],
  equipment: ['required items equipment', 'required items and equipment', 'required items', 'equipment', 'tools and equipment'],
  jobReference: ['job reference', 'job ref', 'reference number', 'ref no'],
  excoReference: ['approved by exco', 'exco approval', 'exco minute', 'exco min', 'exco minute no', 'exco minute number', 'minute no', 'minute number'],
  approvalDate: ['date of approval', 'approval date', 'date approved']
};

const SECTIONS = {
  jobPurpose: ['job purpose', 'job role purpose', 'job role', 'purpose of the job', 'purpose of job', 'job summary', 'overall purpose', 'overall purpose of the job', 'main purpose of the job'],
  principalAccountabilities: ['principal accountabilities', 'key accountabilities', 'key result areas', 'accountabilities'],
  duties: ['duties and responsibilities', 'key duties and responsibilities', 'main duties and responsibilities', 'main duties', 'key responsibilities', 'responsibilities', 'duties'],
  essential: ['essential', 'essential requirements', 'essential qualifications', 'essential qualifications and experience', 'minimum qualifications', 'minimum requirements', 'qualifications and experience', 'qualifications'],
  desirable: ['desirable', 'desirable requirements', 'desirable qualifications', 'added advantage'],
  knowledge: ['knowledge', 'general knowledge', 'general knowledge and cognitive aptitude', 'knowledge requirements', 'knowledge and cognitive aptitude'],
  specialSkills: ['special skills and attributes', 'special skills', 'skills and attributes', 'competencies', 'key competencies', 'skills and competencies']
};

// Headings that only organise the document - they end the section above
// them but hold nothing themselves.
const STRUCTURAL = [
  'person specifications', 'person specification', 'job description', 'job opening request', 'job vacancy details',
  'part a job vacancy details', 'part a', 'part b', 'part b validation', 'validation', 'approvals', 'approval',
  'uganda civil aviation authority', 'signature', 'signatures', 'signed', 'name', 'date', 'prepared by',
  'reviewed by', 'validated by', 'head of department', 'director', 'dhra', 'director general'
];

// Fields a requisition is expected to state; anything here that isn't
// found is reported as missing for HR to fill in.
const EXPECTED = ['jobTitle', 'department', 'reportsTo', 'station', 'salaryScale', 'vacancies', 'contractType',
  'jobPurpose', 'principalAccountabilities', 'duties', 'essential', 'desirable', 'knowledge', 'specialSkills'];

const LABEL_FOR = {
  jobTitle: 'Job title', directorate: 'Directorate', department: 'Department', section: 'Section', station: 'Station / location',
  reportsTo: 'Reports to', directReports: 'No. of direct reports', salaryScale: 'Salary scale', vacancies: 'No. of vacancies',
  advertType: 'Type of advert', contractType: 'Contract type', contractDuration: 'Contract duration',
  expectedReportingDate: 'Expected reporting date', positionStatus: 'Position status', jdStatus: 'JD status', age: 'Age',
  equipment: 'Required items/equipment', jobReference: 'Job reference', excoReference: 'EXCO approval', approvalDate: 'Date of approval',
  jobPurpose: 'Job purpose', principalAccountabilities: 'Principal accountabilities', duties: 'Duties and responsibilities',
  essential: 'Essential requirements', desirable: 'Desirable requirements', knowledge: 'Knowledge', specialSkills: 'Special skills and attributes'
};

const LONGEST_REASONABLE_SCALAR = 160;
const BULLET_RE = /^(?:[•·▪●○◦■□➢➤►\-*–—]|\(?(?:\d{1,2}|[ivx]{1,4}|[a-h])[.)])\s*/i;
// "PART A:", "1.", "3.1", "3.1.", "(a)", "iv)" before a heading or label.
const NUMBERING_RE = /^(?:part\s+[a-z]\b\s*[:.\-–]?\s*|\(?(?:\d{1,2}(?:\.\d{1,2})+\.?|(?:\d{1,2}|[ivx]{1,4}|[a-h])[.)])\s+)/i;
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function normalizeLabel(text) {
  return String(text).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripNumbering(line) {
  return line.replace(NUMBERING_RE, '').trim();
}

function cleanLine(line) {
  return line.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
}

// Every alias as { field, kind, alias, words }, longest first so "salary
// scale level" wins over "scale".
const ALIASES = [
  ...Object.entries(SCALARS).flatMap(([field, list]) => list.map((alias) => ({ field, kind: 'scalar', alias }))),
  ...Object.entries(SECTIONS).flatMap(([field, list]) => list.map((alias) => ({ field, kind: 'section', alias })))
].sort((a, b) => b.alias.length - a.alias.length);

const EXACT = new Map();
for (const a of [...ALIASES].reverse()) EXACT.set(a.alias, a);
const STRUCTURAL_SET = new Set(STRUCTURAL);

// What a line is: a label on its own, a label with its value inline, a
// structural heading, or plain content.
function classify(rawLine) {
  const line = stripNumbering(rawLine);
  const norm = normalizeLabel(line.replace(/:\s*$/, ''));
  if (!norm) return { type: 'content', text: rawLine };
  if (EXACT.has(norm)) return { type: 'label', ...EXACT.get(norm) };
  if (STRUCTURAL_SET.has(norm) || /^part [a-z]\b/.test(norm)) return { type: 'structural' };

  for (const a of ALIASES) {
    // The alias's words at the start of the line, in any case, with the
    // original punctuation allowed between them ("No. of Vacancies").
    const pattern = new RegExp(`^${a.alias.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^A-Za-z0-9]*')}`, 'i');
    const m = pattern.exec(line);
    if (!m) continue;
    const rest = line.slice(m[0].length);
    // A clear separator, then the value: "Department: Finance".
    const sep = /^\s*(?::|\||\t|\s-\s|\s–\s|\s—\s|\s{2,})\s*/.exec(rest);
    if (sep && rest.slice(sep[0].length).trim()) {
      return { type: 'inline', ...a, value: rest.slice(sep[0].length).trim(), separated: true };
    }
    // Table cells a PDF export ran together: "DepartmentFinance". Only when
    // the value starts with a capital or digit straight after the label.
    if (/^[A-Z0-9]/.test(rest) && /[a-z.)]$/i.test(m[0])) {
      return { type: 'inline', ...a, value: rest.trim(), separated: false };
    }
  }
  return { type: 'content', text: rawLine };
}

function isBreak(cls) {
  return cls.type !== 'content';
}

// Section lines into list items. PDF lines wrap mid-sentence, so a line
// that starts in lower case, or follows one ending mid-phrase, continues
// the item above it; a Word paragraph is always its own item.
function toItems(lines, mergeWraps) {
  const items = [];
  let merged = false;
  for (const raw of lines) {
    const hasBullet = BULLET_RE.test(raw);
    const text = raw.replace(BULLET_RE, '').trim();
    if (!text) continue;
    const prev = items[items.length - 1];
    const continues = mergeWraps && prev && !hasBullet
      && (/^[a-z(]/.test(text) || /(?:[,(\-–]|\b(?:and|or|of|the|in|to|with|for|a|an|on|by|as|from))$/i.test(prev));
    if (continues) {
      items[items.length - 1] = `${prev} ${text}`;
      merged = true;
    } else {
      items.push(text);
    }
  }
  return { items, merged };
}

function interpretScalar(field, value) {
  const v = value.trim();
  switch (field) {
    case 'vacancies': {
      const digits = /(\d{1,3})/.exec(v);
      if (digits) return { value: Number(digits[1]), interpreted: !/^\d{1,3}$/.test(v) };
      const word = WORD_NUMBERS[v.toLowerCase().split(/\W/)[0]];
      return word ? { value: word, interpreted: true } : { value: null };
    }
    case 'advertType':
      if (/\binternal\b/i.test(v) && !/\bexternal\b/i.test(v)) return { value: 'Internal', interpreted: v.toLowerCase() !== 'internal' };
      if (/\bexternal\b/i.test(v) && !/\binternal\b/i.test(v)) return { value: 'External', interpreted: v.toLowerCase() !== 'external' };
      return { value: null };
    case 'contractType':
      if (/fixed[\s-]*term/i.test(v)) return { value: 'FixedTermContract', raw: v, interpreted: true };
      if (/permanent|pensionable|full[\s-]*time/i.test(v)) return { value: 'FullTime', raw: v, interpreted: true };
      if (/contract/i.test(v)) return { value: 'Contract', raw: v, interpreted: true };
      return { value: null, raw: v };
    case 'age': {
      const between = /(\d{2})\s*(?:-|–|to|and)\s*(\d{2})/i.exec(v);
      if (between) return { value: { minimumAge: Number(between[1]), maximumAge: Number(between[2]) }, raw: v, interpreted: true };
      const max = /(?:not\s+(?:above|older\s+than|exceed(?:ing)?|more\s+than)|(?<!not\s)(?:below|under)|maximum(?:\s+of)?|max\.?|up\s+to)\s*(\d{2})/i.exec(v);
      // "above"/"over" only when not part of "not above"/"not over".
      const min = /(?:not\s+(?:below|younger\s+than|less\s+than)|(?<!not\s)(?:above|over)|at\s+least|minimum(?:\s+of)?|min\.?)\s*(\d{2})/i.exec(v);
      if (max || min) {
        return { value: { minimumAge: min ? Number(min[1]) : null, maximumAge: max ? Number(max[1]) : null }, raw: v, interpreted: true };
      }
      return { value: null, raw: v };
    }
    case 'directReports': {
      if (/^(none|nil|n\/a|0)$/i.test(v)) return { value: 'None' };
      return { value: v };
    }
    default:
      return { value: v };
  }
}

function confidenceFor({ interpreted, conflicting, separated, value }) {
  if (typeof value === 'string' && value.length > LONGEST_REASONABLE_SCALAR) return 'low';
  if (interpreted || conflicting || separated === false) return 'medium';
  return 'high';
}

/**
 * parseRequisitionText(text, { format }) -> {
 *   fields: { [key]: { value, confidence, label, raw? } },
 *   missing: [key], labels: LABEL_FOR, warnings: [string]
 * }
 * format 'pdf' rejoins wrapped lines; 'docx' treats each paragraph as one.
 */
function parseRequisitionText(text, { format = 'docx' } = {}) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const classes = lines.map(classify);
  const scalarHits = {};
  const sections = {};
  const warnings = [];

  const recordScalar = (field, value, separated) => {
    if (!value) return;
    (scalarHits[field] = scalarHits[field] || []).push({ value, separated });
  };

  for (let i = 0; i < lines.length; i++) {
    const cls = classes[i];
    if (cls.type === 'inline' && cls.kind === 'scalar') {
      recordScalar(cls.field, cls.value, cls.separated);
    } else if (cls.type === 'label' && cls.kind === 'scalar') {
      // Table layout: the value is the next line, unless that is itself a label.
      if (i + 1 < lines.length && !isBreak(classes[i + 1])) {
        recordScalar(cls.field, lines[i + 1], true);
        i += 1;
      }
    } else if ((cls.type === 'label' || cls.type === 'inline') && cls.kind === 'section') {
      const body = cls.type === 'inline' ? [cls.value] : [];
      let j = i + 1;
      while (j < lines.length && !isBreak(classes[j])) body.push(lines[j++]);
      if (!sections[cls.field] && body.length) sections[cls.field] = body;
      i = j - 1;
    }
  }

  const fields = {};
  for (const [field, hits] of Object.entries(scalarHits)) {
    const distinct = [...new Set(hits.map((h) => normalizeLabel(h.value)))];
    const first = hits[0];
    const conflicting = distinct.length > 1;
    if (conflicting) {
      warnings.push(`${LABEL_FOR[field]} differs within the document ("${hits.map((h) => h.value).filter((v, k, a) => a.indexOf(v) === k).join('" / "')}") - the first is used; check it.`);
    }
    const read = interpretScalar(field, first.value);
    if (read.value === null || read.value === undefined || read.value === '') {
      warnings.push(`${LABEL_FOR[field]} "${first.value}" could not be read - fill it in by hand.`);
      continue;
    }
    fields[field] = {
      value: read.value,
      confidence: confidenceFor({ interpreted: read.interpreted, conflicting, separated: first.separated, value: read.value }),
      label: LABEL_FOR[field],
      ...(read.raw ? { raw: read.raw } : {})
    };
  }

  for (const [field, body] of Object.entries(sections)) {
    if (field === 'jobPurpose') {
      // Paragraphs, not items - a PDF's wrapped lines are rejoined into one.
      const paragraphs = format === 'pdf' ? [body.join(' ')] : body;
      fields[field] = { value: paragraphs.map((p) => p.replace(BULLET_RE, '').trim()).filter(Boolean), confidence: 'high', label: LABEL_FOR[field] };
      continue;
    }
    const { items, merged } = toItems(body, format === 'pdf');
    if (items.length) {
      fields[field] = { value: items, confidence: merged ? 'medium' : 'high', label: LABEL_FOR[field] };
    }
  }

  const missing = EXPECTED.filter((key) => !fields[key]);
  if (!fields.excoReference && !fields.approvalDate && !/\bexco\b/i.test(text)) {
    warnings.push('No EXCO approval was found in the document - make sure this is the approved, signed requisition.');
  }
  return { fields, missing, labels: LABEL_FOR, warnings };
}

module.exports = { parseRequisitionText, normalizeLabel, classify, LABEL_FOR, EXPECTED };
