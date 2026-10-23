// Reads the details of a CV from its text (cvParser.extractText), whatever
// the template: built-in rules only - no outside service, the CV never
// leaves UCAA's servers. Everything found is a suggestion the candidate
// checks (the UI says so); a field it can't read with some confidence is
// left empty, with a warning, rather than guessed.
//
// How it reads a CV:
// - the text is tidied (bullets, dashes, ligatures, letter-spaced headings,
//   page numbers) and split into lines, blank lines kept as block breaks;
// - section headings are recognised from a wide vocabulary ("Academic
//   Qualifications", "Employment Record", "Trainings Attended", ...), as is
//   any heading the CV uses for something else (skills, referees, ...),
//   which ends the section before it;
// - each section is cut into blocks, one per entry - by blank lines, a new
//   date range, a repeated "Position:"/"Employer:" label, or a new heading
//   line after a list of duties - and each block read for its parts, by
//   label first ("Organisation: ..."), else by what the words look like
//   (an employer's "Ltd"/"Authority", a job title's "Officer"/"Manager",
//   an institution's "University"), in whatever order the template puts them;
// - dates are read in the usual forms ("Jan 2019 - Present", "03/2018 to
//   date", "2015-2019", "since 2020", "12th March 1990").

const { educationKey, workExperienceKey, certificateKey, dedupeBy } = require('./entryDedup');

// ---- Text ------------------------------------------------------------------

const BULLET = '•';
function tidy(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[   \t]/g, ' ')
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi')
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
    // Bullet glyphs, including Word's symbol-font ones (U+F0B7, U+F0A7, U+F0D8, ...).
    .replace(/[•●▪■◦‣⁃∙·➢✓✔►▶→⇒❖♦◆]/g, BULLET)
    .replace(/[‐‑]/g, '-')
    .replace(/\s*[‒–—―−]\s*/g, ' - ');
}

// "E D U C A T I O N" / "W O R K   E X P E R I E N C E" -> normal words,
// only when the whole line has that shape.
const LETTER_SPACED_RE = /^[A-Za-z&](\s[A-Za-z&])+(\s{2,}[A-Za-z&](\s[A-Za-z&])*)*$/;
function collapseLetterSpacing(line) {
  if (!LETTER_SPACED_RE.test(line)) return line;
  return line.split(/\s{2,}/).map((word) => word.replace(/\s+/g, '')).join(' ');
}

const NOISE_RE = /^(page\s*\d+(\s*(of|\/)\s*\d+)?|\d+\s*(of|\/)\s*\d+|-\s*\d+\s*-|curriculum\s+vitae|curriculum\s+vitae\s*\(cv\)|resume|r[ée]sum[ée]|c\.?\s?v\.?)$/i;

function toLines(text) {
  return tidy(text).split('\n').map((raw) => {
    const line = collapseLetterSpacing(raw.trim()).replace(/[ ]{2,}/g, ' ').replace(/^(\|\s*)+|(\s*\|)+$/g, '').trim();
    return NOISE_RE.test(line) ? '' : line;
  });
}

const isBullet = (line) => /^(•|[-*>o▪]\s|\d{1,2}[.)]\s|[a-z][.)]\s|[ivx]{1,4}[.)]\s)/i.test(line);
const stripBullet = (line) => line.replace(/^(•\s*|[-*>o▪]\s+|\d{1,2}[.)]\s+|[a-z][.)]\s+|[ivx]{1,4}[.)]\s+)+/i, '').trim();
const words = (line) => line.split(/\s+/).filter(Boolean);
const clean = (s) => String(s || '').replace(/\s*\|\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,;:|.\-/]+|[\s,;:|\-/]+$/g, '').trim();

// A name written all in capitals ("UGANDA AIRLINES") in ordinary case;
// short words that aren't joining words stay as acronyms ("URA", "ICT").
const JOINING = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'on', 'to', 'de', 'la']);
function recase(s) {
  if (!s || /[a-z]/.test(s) || !/[A-Z]{2}/.test(s) || !/\s/.test(s.trim())) return s;
  return s.split(/(\s+|-)/).map((w, i) => {
    const lower = w.toLowerCase();
    if (JOINING.has(lower) && i) return lower;
    if (w.replace(/[^A-Z]/g, '').length <= 3 && !/^[A-Z][a-z]/.test(w)) return w;
    return lower.replace(/(^|[(.'])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join('');
}

// ---- Dates -----------------------------------------------------------------

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const PRESENT = "(present|current(?:ly)?|now|to\\s*date|till\\s*(?:date|now)|todate|ongoing|date|on-?going)";
// One date: "12th March 1990", "March 12, 1990", "Mar. 2019", "Sept '19",
// "03/2019", "12/03/2019", "2019-03", "2019".
const DATE_SRC = [
  `(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+((?:19|20)\\d{2})`,
  `${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})`,
  `${MONTH}\\.?,?\\s*(?:'|’)?((?:19|20)\\d{2}|\\d{2})\\b`,
  '(\\d{1,2})[/.-](\\d{1,2})[/.-]((?:19|20)\\d{2})',
  '\\b(\\d{1,2})[/.-]((?:19|20)\\d{2})\\b',
  '\\b((?:19|20)\\d{2})[/.-](\\d{1,2})\\b(?![/.-]\\d)',
  '\\b((?:19|20)\\d{2})\\b'
];
const DATE_RES = DATE_SRC.map((s) => new RegExp(s, 'i'));
const ANY_DATE_RE = new RegExp(DATE_SRC.map((s) => `(?:${s})`).join('|'), 'gi');
const PRESENT_RE = new RegExp(`\\b${PRESENT}\\b`, 'i');
const thisYear = () => new Date().getFullYear();
const pad = (n) => String(n).padStart(2, '0');

function readDate(text) {
  for (let i = 0; i < DATE_RES.length; i += 1) {
    const m = text.match(DATE_RES[i]);
    if (!m) continue;
    let year; let month = null; let dayN = null;
    if (i === 0) { dayN = +m[1]; month = MONTHS[m[2].toLowerCase()]; year = +m[3]; }
    else if (i === 1) { month = MONTHS[m[1].toLowerCase()]; dayN = +m[2]; year = +m[3]; }
    else if (i === 2) { month = MONTHS[m[1].toLowerCase()]; year = m[2].length === 2 ? 2000 + +m[2] - (2000 + +m[2] > thisYear() + 1 ? 100 : 0) : +m[2]; }
    else if (i === 3) { dayN = +m[1]; month = +m[2]; year = +m[3]; if (month > 12 && dayN <= 12) [dayN, month] = [month, dayN]; }
    else if (i === 4) { month = +m[1]; year = +m[2]; }
    else if (i === 5) { year = +m[1]; month = +m[2]; }
    else { year = +m[1]; }
    if (month && (month < 1 || month > 12)) month = null;
    if (dayN && (dayN < 1 || dayN > 31)) dayN = null;
    if (year < 1940 || year > thisYear() + 6) return null;
    return { year, month, day: dayN, iso: `${year}-${pad(month || 1)}-${pad(dayN || 1)}`, exact: Boolean(month) };
  }
  return null;
}

// Every date in a line, in order, with where it is.
function datesIn(line) {
  const found = [];
  ANY_DATE_RE.lastIndex = 0;
  let m;
  while ((m = ANY_DATE_RE.exec(line))) {
    const d = readDate(m[0]);
    if (d) found.push({ ...d, index: m.index, text: m[0] });
  }
  return found;
}

// A period: "Jan 2019 - Present", "2015 to 2019", "since 2020", "2018 - date".
// { start, end, current, text } (ISO days; end '' when current or unknown), or null.
function readRange(line) {
  const dates = datesIn(line);
  if (!dates.length) return null;
  const [a, b] = dates;
  const between = b ? line.slice(a.index + a.text.length, b.index) : '';
  if (b && /^\s*(-|to|until|till|through|thru|–|—|\/|\|)?\s*$/i.test(between)) {
    return { start: a.iso, end: b.iso, current: false, text: line.slice(a.index, b.index + b.text.length), startDate: a, endDate: b };
  }
  const after = line.slice(a.index + a.text.length);
  const present = after.match(new RegExp(`^\\s*(?:-|to|until|till|–|—)?\\s*${PRESENT}\\b`, 'i'));
  if (present) return { start: a.iso, end: '', current: true, text: line.slice(a.index, a.index + a.text.length + present[0].length), startDate: a };
  const since = line.slice(0, a.index).match(/\b(since|from)\s*$/i);
  if (since) return { start: a.iso, end: '', current: since[1].toLowerCase() === 'since', text: line.slice(a.index - since[0].length, a.index + a.text.length), startDate: a };
  return { start: a.iso, end: '', current: false, single: true, text: a.text, startDate: a };
}

// The line with its dates (and periods) taken out; " | " cell breaks kept.
const stripDates = (line) => line
  .replace(new RegExp(`\\b(since|from)?\\s*(${ANY_DATE_RE.source})(\\s*(-|to|until|till|–)?\\s*((${ANY_DATE_RE.source})|${PRESENT}\\b))?`, 'gi'), ' ')
  .replace(/\(\s*[-,]?\s*\)/g, ' ')
  .replace(/(\s*\|\s*){2,}/g, ' | ')
  .replace(/^[\s|,;:\-]+|[\s|,;:\-]+$/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();
const withoutDates = (line) => clean(stripDates(line));

// ---- Vocabulary ------------------------------------------------------------

// Headings compared in one spelling: "&" as "and", licence/license,
// certificates/certifications, organisation/organization.
const norm = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/licen[cs]e/g, 'license').replace(/certificates?\b/g, 'certification').replace(/certifications\b/g, 'certification')
  .replace(/organi[sz]ation/g, 'organization').replace(/\s+/g, ' ').trim();
const vocab = (list) => new Set(list.map(norm));

const HEADINGS = {
  education: vocab([
    'education', 'educational background', 'education background', 'educational qualifications', 'educational qualification',
    'academic background', 'academic qualifications', 'academic qualification', 'academic profile', 'academic history',
    'academic records', 'academic credentials', 'academics', 'qualifications', 'education and qualifications',
    'education and training', 'educational attainment', 'schools attended', 'institutions attended', 'formal education',
    'academic and professional qualifications', 'education history', 'academic achievements', 'education details',
    'academic details', 'educational history', 'education and certifications', 'academic qualifications attained'
  ]),
  workExperience: vocab([
    'experience', 'work experience', 'working experience', 'professional experience', 'employment', 'employment history',
    'employment record', 'employment records', 'employment experience', 'work history', 'career history', 'career experience',
    'career record', 'relevant experience', 'professional background', 'positions held', 'job experience', 'work record',
    'professional history', 'internships', 'internship', 'internship experience', 'work and internship experience',
    'volunteer experience', 'previous employment', 'employment background', 'relevant work experience',
    'professional work experience', 'work experience and achievements', 'employment and experience', 'experience summary',
    'professional employment', 'past employment', 'current and previous employment', 'other experience'
  ]),
  certificates: vocab([
    'certifications', 'certification', 'certificates', 'licenses', 'licences', 'licenses and certifications',
    'licences and certificates', 'certifications and licenses', 'certificates and licences', 'professional certifications',
    'professional certificates', 'professional qualifications', 'professional training', 'trainings', 'training',
    'trainings attended', 'short courses', 'short courses attended', 'courses', 'courses attended', 'professional development',
    'other qualifications', 'other trainings', 'additional training', 'workshops', 'workshops and seminars',
    'seminars and workshops', 'awards and certifications', 'certifications and awards', 'accreditations',
    'professional courses', 'training and certifications', 'trainings and workshops', 'other professional qualifications',
    'continuous professional development', 'cpd'
  ]),
  oLevel: vocab(['o level', 'o level results', 'uce', 'uce results', 'ordinary level', 'uganda certificate of education', 'o level subjects']),
  aLevel: vocab(['a level', 'a level results', 'uace', 'uace results', 'advanced level', 'uganda advanced certificate of education', 'a level subjects']),
  other: vocab([
    'skills', 'key skills', 'core skills', 'technical skills', 'computer skills', 'soft skills', 'ict skills', 'it skills',
    'competencies', 'core competencies', 'key competencies', 'skills and competencies', 'skills and abilities', 'abilities',
    'languages', 'language', 'language proficiency', 'languages spoken', 'referees', 'references', 'reference',
    'hobbies', 'interests', 'hobbies and interests', 'personal details', 'personal information', 'personal data',
    'personal particulars', 'bio data', 'biodata', 'personal profile', 'profile', 'professional profile', 'summary',
    'professional summary', 'career summary', 'executive summary', 'profile summary', 'objective', 'career objective',
    'objectives', 'career objectives', 'about me', 'personal statement', 'achievements', 'key achievements',
    'accomplishments', 'awards', 'honours', 'honors', 'awards and honours', 'publications', 'projects', 'research',
    'memberships', 'professional memberships', 'affiliations', 'professional affiliations', 'volunteering',
    'extra curricular activities', 'co curricular activities', 'leadership', 'leadership experience', 'declaration',
    'contact', 'contacts', 'contact details', 'contact information', 'strengths', 'attributes', 'personal attributes',
    'tools', 'software', 'additional information', 'other information', 'computer literacy', 'interpersonal skills'
  ])
};

// A heading line, as { section, rest } (rest: what followed "Heading:" on
// the same line), or null.
function headingOf(line) {
  if (!line || line.length > 70) return null;
  const bare = line.replace(/^([0-9]{1,2}|[ivx]{1,4}|[a-h])[.)]\s+/i, '').replace(/\(.*?\)/g, ' ');
  const colon = bare.indexOf(':');
  const candidates = colon > 0 ? [[bare.slice(0, colon), bare.slice(colon + 1).trim()], [bare, '']] : [[bare, '']];
  for (const [head, rest] of candidates) {
    const key = norm(head);
    if (!key || words(key).length > 7) continue;
    for (const [section, set] of Object.entries(HEADINGS)) {
      if (set.has(key)) return { section, rest };
    }
  }
  // Some other heading in capitals ending in a colon ("HOBBIES:") ends the
  // section before it. Not without the colon: a name, an employer or a
  // place is often written in capitals too.
  if (/^[A-Z][A-Z &/]{2,30}:$/.test(bare.trim()) && words(bare).length <= 4) return { section: 'other', rest: '' };
  return null;
}

const INSTITUTION_RE = /\b(universit(y|ies)|college|institute|institution|polytechnic|school|academy|seminary|s\.?\s?s\.?\s?s\b|secondary|high school|vocational|training (centre|center|school)|campus|(MUBS|MUST|UCU|IUIU|UTAMU|KIU|KYU|UMI|EASA|UMU|NDU|MUK|LDC|ICPAU|ACCA|CIPS|CIM|UNEB)\b)/i;
const ORG_RE = /\b(ltd|limited|plc|inc|llc|llp|co\.|company|corporation|corp|group|holdings|authority|ministry|bank|airlines?|airways|airport|aviation|organi[sz]ation|council|agency|bureau|commission|board|fund|trust|foundation|association|society|enterprises?|consult(ing|ants?|ancy)?|solutions|technologies|technology|systems|services|hospital|clinic|health|centre|center|government|district|municipal|city|hotel|resort|church|embassy|united nations|un|undp|unicef|wfp|who|usaid|ngo|project|programme|program|partners|international|africa|uganda|kenya|rwanda|tanzania|ug|industries|logistics|cargo|handling|telecom|mtn|airtel|stanbic|centenary|insurance|sacco|cooperative|parliament|judiciary|police|army|forces|updf|ura|nssf|kcca|ucaa|unra|nwsc|umeme|uetcl|ubos|unbs|nita|ucc|bou|caa)\b/i;
const TITLE_RE = /\b(officer|manager|engineer|assistant|intern|director|accountant|analyst|clerk|technician|controller|supervisor|co-?ordinator|specialist|consultant|lecturer|teacher|tutor|administrator|developer|programmer|head|lead|secretary|auditor|inspector|pilot|attendant|agent|driver|nurse|doctor|executive|associate|representative|volunteer|trainee|adviser|advisor|planner|architect|surveyor|economist|statistician|cashier|receptionist|librarian|mechanic|electrician|operator|dispatcher|chief|president|chairperson|chairman|member|designer|editor|writer|researcher|scientist|instructor|facilitator|counsel(l?or)?|lawyer|advocate|registrar|bursar|storekeeper|procurement|marketer|sales|teller|guard|warden|steward|cadet|apprentice|graduate trainee|internee|attach[eé]|support|commander|captain|first officer|dispatcher|marshal|fireman|firefighter|ict|it|hr|finance|admin)\b/i;
const LOCATION_RE = /^(kampala|entebbe|uganda|kenya|nairobi|jinja|gulu|mbarara|arua|mbale|masaka|lira|fort portal|hoima|soroti|kabale|tororo|mukono|wakiso|tanzania|dar es salaam|rwanda|kigali|south sudan|juba|burundi|drc|congo|remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|temporary|permanent)(,?\s*(uganda|kenya|tanzania|rwanda|south sudan))?$/i;

// ---- Qualifications ---------------------------------------------------------

const QUALIFICATIONS = [
  ['PhD', /\b(ph\.?\s?d|d\.?\s?phil|doctor(ate)?\s+of\s+philosophy|doctorate)\b/i],
  ['Masters', /\b(master'?s?|m\.\s?sc|msc|m\.\s?a\.|mba|m\.\s?b\.\s?a|m\.?\s?ed|m\.?\s?phil|ll\.?\s?m|m\.?\s?eng|m\.?\s?com|mpa|mph|m\.?\s?tech|maccs?)\b/i],
  ['Postgraduate', /\b(post\s?-?\s?graduate|p\.?\s?g\.?\s?d\.?\w*|pgd\w*)\b/i],
  ['Bachelors', /\b(bachelor'?s?|b\.\s?sc|bsc|b\.\s?a\.|ba\b(?=\s*(\(|in|of|hons|[A-Z]))|bba|b\.?\s?b\.?\s?a|b\.?\s?com|b\.?\s?ed|b\.?\s?eng|b\.?\s?tech|ll\.?\s?b|mb\.?\s?ch\.?\s?b|b\.?\s?stat|bis|b\.?\s?arch|b\.?\s?pharm|bds|bvm|(honours\s+)?degree)\b/i],
  ['Diploma', /\b(diploma|dip\.)/i],
  ['Certificate', /\b(certificate|cert\.|uace|uce|a[\s'-]?level|o[\s'-]?level|advanced level|ordinary level|ple|primary leaving)\b/i]
];
const SECONDARY_RE = /\b(uace|uce|a[\s'-]?level|o[\s'-]?level|advanced level|ordinary level|uganda (advanced )?certificate of education|ple|primary leaving)\b/i;

function qualificationOf(line) {
  for (const [level, re] of QUALIFICATIONS) {
    const m = line.match(re);
    if (m) return { level, match: m };
  }
  return null;
}

function secondaryField(text) {
  if (/\b(uace|a[\s'-]?level|advanced level|uganda advanced certificate)/i.test(text)) return 'Uganda Advanced Certificate of Education (UACE)';
  if (/\b(uce|o[\s'-]?level|ordinary level|uganda certificate of education)/i.test(text)) return 'Uganda Certificate of Education (UCE)';
  if (/\b(ple|primary leaving)/i.test(text)) return 'Primary Leaving Examinations (PLE)';
  return '';
}

const CLASS_RE = /[,;(]?\s*\b(first|second|third|1st|2nd|3rd)\s+class\b.*$|\(?\bhons?\.?\)?|\bhonours\b|[,;(]?\s*\b(upper|lower)\s+(second|division)\b.*$|[,;(]\s*(distinction|credit|merit|pass)\b.*$/gi;

function fieldOfStudy(line, qual) {
  const secondary = secondaryField(line);
  if (secondary) return secondary;
  // The piece of the line that holds the qualification.
  const pieces = line.split(/\s+\|\s+|\s+-\s+|\s+at\s+|,\s+(?=[A-Z])|;\s*/);
  const piece = pieces.find((p) => qual.match && new RegExp(qual.match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(p)) || line;
  const at = piece.search(new RegExp(qual.match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  let after = piece.slice(at + qual.match[0].length);
  const before = piece.slice(0, at);
  after = after.replace(/^['’]?s?\b/i, '').replace(/^\s*(degree|programme|program|course|award)\b/i, '');
  let field = '';
  const inMatch = after.match(/\bin\s+(.+)$/i);
  if (inMatch) field = inMatch[1];
  else field = after.replace(/^\s*(of|:|\.|-)\s*/i, '');
  field = field.replace(/\(([^)]*)\)/, (m, inner) => (field.trim().startsWith('(') ? inner : ''));
  field = withoutDates(field).replace(CLASS_RE, '').replace(INSTITUTION_RE.test(field) ? new RegExp(`\\b(at|from)?\\s*[A-Z][\\w.&' ]*${INSTITUTION_RE.source}.*$`, 'i') : /$^/, '');
  field = clean(field.split(/\s+(?:with|majoring|specializ|specialis)/i)[0]);
  if (!field && before.trim()) field = clean(withoutDates(before));
  return field.length > 90 ? field.slice(0, 90).trim() : field;
}

function institutionIn(lines, qualLine) {
  for (const line of lines) {
    const segments = line.split(/\s+\|\s+|\s+-\s+|,\s+|;\s*|\s+at\s+|\s+from\s+|\(|\)/);
    const seg = segments.find((s) => INSTITUTION_RE.test(s) && !(s === qualLine && qualificationOf(s) && !/universit|college|institute|school|academy/i.test(s)));
    if (seg) {
      const q = qualificationOf(seg);
      let name = clean(withoutDates(seg));
      if (q && /universit|college|institute|school|academy|polytechnic/i.test(name)) {
        // "BSc at Makerere University" already split; keep just the institution part.
        const m = name.match(new RegExp(`([A-Z][\\w.&' -]*?)?${INSTITUTION_RE.source}([\\w.&' -]*)`, 'i'));
        if (m) name = clean(m[0]);
      }
      if (name && !qualificationOf(name)) return name;
      if (name) return name;
    }
  }
  return '';
}

// ---- Sections ----------------------------------------------------------------

function splitSections(lines) {
  const sections = { education: [], workExperience: [], certificates: [], oLevel: [], aLevel: [], other: [], top: [] };
  let current = 'top';
  let found = false;
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) {
      current = heading.section;
      found = found || heading.section !== 'other';
      sections[current].push('');
      if (heading.rest) sections[current].push(heading.rest);
      continue;
    }
    if (!isHeaderRow(line)) sections[current].push(line);
  }
  return { sections, found };
}

// A table's header row ("Year | Institution | Award") - not an entry.
const HEADER_CELLS = vocab([
  'year', 'years', 'date', 'dates', 'period', 'duration', 'from', 'to', 'institution', 'institutions', 'school', 'university',
  'award', 'awards', 'qualification', 'qualifications', 'course', 'programme', 'program', 'level', 'grade', 'class',
  'position', 'title', 'job title', 'designation', 'employer', 'organisation', 'organization', 'company', 'duties',
  'responsibilities', 'certificate', 'certification', 'issuer', 'awarding body', 'institution attended', 'name of institution',
  'subject', 'subjects', 'no', 's n', 'sn', 'serial', 'remarks', 'location', 'year of completion', 'year completed', 'field of study'
]);
const isHeaderRow = (line) => line.includes('|') && line.split('|').every((c) => HEADER_CELLS.has(norm(c)));

// Lines cut into blocks at blank lines (several blank lines count once).
function blocksByBlank(lines) {
  const blocks = [];
  let block = [];
  for (const line of lines) {
    if (!line) { if (block.length) blocks.push(block); block = []; } else block.push(line);
  }
  if (block.length) blocks.push(block);
  return blocks;
}

// ---- Education ---------------------------------------------------------------

function parseEducation(lines) {
  // An entry is a block that names a qualification; a block naming more
  // than one (a list, or a table with a row each) is split per qualification.
  const entries = [];
  for (const block of blocksByBlank(lines)) {
    let group = [];
    const groups = [];
    for (const line of block) {
      const q = qualificationOf(line);
      const hasQual = group.some((l) => qualificationOf(l));
      const hasInst = group.some((l) => INSTITUTION_RE.test(l));
      // A new entry: another qualification, or a new institution / date line
      // once this one is complete.
      if (group.length && ((q && hasQual) || (hasQual && hasInst && (INSTITUTION_RE.test(line) || (readRange(line) && !q && withoutDates(line).length < 3 && group.some((l) => readRange(l))))))) {
        groups.push(group); group = [];
      }
      group.push(line);
    }
    if (group.length) groups.push(group);
    for (const g of groups) {
      const qualLine = g.find((l) => qualificationOf(l));
      if (!qualLine) continue;
      const qual = qualificationOf(qualLine);
      const text = g.join(' ');
      const years = g.flatMap((l) => datesIn(l)).map((d) => d.year).filter((y) => y <= thisYear());
      const ongoing = PRESENT_RE.test(text) && !/\bdate of\b/i.test(text);
      const cgpa = text.match(/\b(?:c\.?\s?g\.?\s?p\.?\s?a|g\.?\s?p\.?\s?a)\b\.?\s*(?:of|:|-)?\s*([0-4]\.\d{1,2}|5(?:\.0{1,2})?)\b/i);
      entries.push({
        institution: recase(institutionIn(g, qualLine)),
        qualificationLevel: qual.level,
        fieldOfStudy: recase(fieldOfStudy(stripBullet(qualLine), qual)),
        yearCompleted: ongoing || !years.length ? null : Math.max(...years),
        cgpa: cgpa ? cgpa[1] : null
      });
    }
  }
  return entries;
}

// ---- Work experience ---------------------------------------------------------

const LABELS = {
  title: /^(position(\s+held)?|job\s*title|title|designation|role|post|rank|capacity)\s*[:\-–]\s*(.+)$/i,
  employer: /^(employer|organi[sz]ation|company|institution|establishment|name\s+of\s+(employer|organi[sz]ation|company|institution)|place\s+of\s+work|work\s*place|department|station|duty\s+station)\s*[:\-–]\s*(.+)$/i,
  period: /^(period|duration|dates?|from|year|years|time|tenure|date\s+of\s+(employment|service))\s*[:\-–]\s*(.+)$/i,
  duties: /^(main\s+|key\s+|major\s+)?(duties\s+and\s+responsibilities|duties\s*\/\s*responsibilities|roles?\s+and\s+responsibilities|responsibilities|duties|roles?|achievements|tasks|accomplishments)\s*(performed|included|held)?\s*:\s*(.*)$/i
};

function labelOf(line) {
  for (const [kind, re] of Object.entries(LABELS)) {
    const m = line.match(re);
    if (m) return { kind, value: clean(m[m.length - 1]) };
  }
  return null;
}

// Title and employer among the header lines of an entry.
function titleAndEmployer(headerLines) {
  const segments = [];
  for (const line of headerLines) {
    const atMatch = line.match(/^(.+?)\s+(?:at|@|with)\s+(.+)$/i);
    if (atMatch && !INSTITUTION_RE.test(atMatch[1])) {
      segments.push({ text: atMatch[1], hint: 'title' }, { text: atMatch[2], hint: 'employer' });
      continue;
    }
    for (const part of line.split(/\s*\|\s*|\s+-\s+|;\s+|\s+\/\s+/)) {
      // A comma separates a place ("Stanbic Bank, Kampala") or a title from
      // an employer ("Legal Officer, Kampala Capital City Authority"), not
      // the parts of a name ("Ministry of Finance, Planning and Economic Development").
      const pieces = part.split(/,\s+/).filter((p) => !LOCATION_RE.test(clean(p)));
      const titleAt = pieces.findIndex((p) => TITLE_RE.test(p) && !ORG_RE.test(p));
      const orgAt = pieces.findIndex((p, i) => i !== titleAt && ORG_RE.test(p));
      if (pieces.length > 1 && titleAt >= 0 && orgAt >= 0) {
        segments.push({ text: pieces[titleAt], hint: 'title' }, { text: pieces.filter((p, i) => i !== titleAt).join(', '), hint: 'employer' });
      } else if (pieces.length) {
        segments.push({ text: pieces.join(', ') });
      }
    }
  }
  const parts = segments.map((s) => ({ ...s, text: withoutDates(s.text) }))
    .filter((s) => s.text && !LOCATION_RE.test(s.text) && /[a-z]/i.test(s.text) && words(s.text).length <= 14);
  const score = (s, re) => (s.text.match(new RegExp(re.source, 'gi')) || []).length;
  let title = parts.find((s) => s.hint === 'title');
  let employer = parts.find((s) => s.hint === 'employer');
  if (!employer) {
    employer = [...parts].filter((s) => s !== title && score(s, ORG_RE) > score(s, TITLE_RE)).sort((a, b) => score(b, ORG_RE) - score(a, ORG_RE))[0];
  }
  if (!title) {
    title = [...parts].filter((s) => s !== employer && score(s, TITLE_RE) > 0).sort((a, b) => score(b, TITLE_RE) - score(a, TITLE_RE))[0];
  }
  const rest = parts.filter((s) => s !== title && s !== employer);
  if (!title && rest.length) title = rest.shift();
  if (!employer && rest.length) employer = rest.shift();
  return { jobTitle: title ? title.text : '', employer: employer ? employer.text : '' };
}

const isContinuation = (prev, line) => /^[a-z(]/.test(line) && prev && !/[.;:!?]$/.test(prev);
// A sentence about the work ("Prepared monthly financial statements ..."),
// not a title or an employer.
const DUTY_RE = /^(prepar|manag|led\b|lead\b|develop|co-?ordinat|supervis|maintain|ensur|conduct|provid|support|assist|implement|design|monitor|handl|organi[sz]|review|train|plan|oversaw|oversee|work(ed|ing)?\b|perform|carr(y|ied)|responsib|creat|establish|improv|reduc|increas|deliver|draft|liais|participat|process|record|resolv|set\s+up|install|configur|administer|analy[sz]|report|advis|communicat|represent|negotiat|direct|execut|facilitat|compil|post(ed|ing)\b|reconcil|audit|inspect|operat|introduc|achiev|served|serving|taught|teach|guid|mentor|built|build|wrote|writ|ran\b|run\b|act(ed|ing)\s+as|in\s+charge|tasked|charged)/i;
const isDutyText = (line) => words(line).length >= 4 && (DUTY_RE.test(line) || /[.;]$/.test(line) || words(line).length > 14);

function parseWork(lines) {
  const entries = [];
  let cur = null;
  const start = () => { cur = { headers: [], labels: {}, range: null, duties: [], blankAfterHeader: false }; entries.push(cur); };
  const complete = () => cur && (cur.range || cur.labels.period) && (cur.headers.length || cur.labels.title || cur.labels.employer);
  let afterBlank = false;

  for (const line of lines) {
    if (!line) { afterBlank = true; continue; }
    const label = labelOf(line);
    const bullet = isBullet(line);
    const range = !bullet && readRange(line);
    const headerLike = !bullet && !label && !isDutyText(line);

    if (!cur) start();
    else if (label && (label.kind === 'title' || label.kind === 'employer' || label.kind === 'period') && (cur.labels[label.kind] || (cur.duties.length && label.kind !== 'period'))) start();
    else if (range && !range.single && (cur.range || cur.labels.period) && (cur.duties.length || cur.headers.length)) start();
    else if (headerLike && cur.duties.length && !isContinuation(cur.duties[cur.duties.length - 1], line) && (range || afterBlank || TITLE_RE.test(line) || ORG_RE.test(line))) start();
    else if (afterBlank && complete() && headerLike) start();
    afterBlank = false;

    if (label) {
      if (label.kind === 'duties') { cur.inDuties = true; if (label.value) cur.duties.push(stripBullet(label.value)); continue; }
      cur.labels[label.kind] = label.value;
      if (label.kind === 'period') cur.range = readRange(label.value) || cur.range;
      continue;
    }
    if (bullet || cur.inDuties || (!headerLike && (cur.headers.length || cur.range))) {
      const duty = stripBullet(line);
      const prev = cur.duties[cur.duties.length - 1];
      if (prev && isContinuation(prev, duty) && !bullet) cur.duties[cur.duties.length - 1] = `${prev} ${duty}`;
      else if (duty && !(readRange(duty) && withoutDates(duty).length < 3)) cur.duties.push(duty);
      continue;
    }
    if (range && !cur.range) cur.range = range;
    const rest = stripDates(line);
    if (rest) cur.headers.push(rest);
  }

  return entries.map((e) => {
    const parsed = titleAndEmployer(e.headers);
    const yearOnly = Boolean(e.range && !e.range.startDate.exact);
    const jobTitle = e.labels.title || parsed.jobTitle;
    const employer = e.labels.employer || parsed.employer;
    const range = e.range;
    return {
      employer: recase(clean(employer)),
      jobTitle: recase(clean(jobTitle)),
      startDate: range ? range.start : '',
      endDate: range && !range.current && !range.single ? range.end : '',
      duties: e.duties.map((d) => d.replace(/\s+/g, ' ').trim()).filter((d) => d.length > 2).slice(0, 25),
      yearOnly
    };
  }).filter((e) => (e.jobTitle || e.employer) && (e.startDate || (e.jobTitle && e.employer)));
}

// ---- Certificates --------------------------------------------------------------

function parseCertificates(lines) {
  const entries = [];
  let cur = null;
  for (const raw of lines) {
    if (!raw) { cur = null; continue; }
    const line = stripBullet(raw);
    const dateOnly = readRange(line) && withoutDates(line).length < 3;
    if (dateOnly && cur) { cur.dates = cur.dates || readRange(line); continue; }
    // "Issued by: ...", "Awarded by ..." under the name.
    const by = line.match(/^(issued|awarded|offered|conducted|organi[sz]ed)\s+by\s*:?\s*(.+)$/i) || line.match(/^(issuer|institution|organi[sz]ation|provider)\s*:\s*(.+)$/i);
    if (by && cur) { cur.issuer = clean(withoutDates(by[2])); cur.dates = cur.dates || readRange(line); continue; }
    if (cur && !isBullet(raw) && isContinuation(cur.text, line)) { cur.text += ` ${line}`; continue; }
    cur = { text: line, dates: readRange(line) };
    entries.push(cur);
  }
  return entries.map((c) => {
    const text = stripDates(c.text.replace(/\b(expir(es|y|ed)|valid\s+(until|till|to))\b.*$/i, ''))
      .replace(/(\s*\|)?\s*\b(issued|awarded|obtained|completed|date)\b\s*:?\s*(?=\||$)/gi, '')
      .replace(/^[\s|]+|[\s|]+$/g, '');
    let name = text;
    let issuer = c.issuer || '';
    if (!issuer) {
      const by = text.match(/^(.+?)(?:\s+(by|from|at)\s+|\s*(\|)\s*|\s+(-)\s+|(,)\s+)(.+)$/i);
      const looksLikeIssuer = (s) => ORG_RE.test(s) || INSTITUTION_RE.test(s) || (words(s).length <= 6 && words(s).every((w) => /^[A-Z0-9(&]/.test(w)));
      if (by && looksLikeIssuer(by[6]) && !qualificationOf(by[6])) { name = by[1]; issuer = by[6]; }
      else {
        const paren = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (paren && (ORG_RE.test(paren[2]) || INSTITUTION_RE.test(paren[2]) || /^[A-Z&. ]{2,12}$/.test(paren[2]))) { name = paren[1]; issuer = paren[2]; }
      }
    }
    const expiry = c.text.match(/\b(?:expir(?:es|y|ed)|valid\s+(?:until|till|to))\b\s*:?\s*(.+)$/i);
    const expiryDate = expiry ? readDate(expiry[1]) : null;
    const d = c.dates;
    return {
      name: recase(clean(name)),
      issuingOrganization: recase(clean(issuer)),
      issueDate: d ? d.start : '',
      expiryDate: expiryDate ? expiryDate.iso : (d && !d.single && !d.current ? d.end : '')
    };
  }).filter((c) => c.name && c.name.length > 2 && words(c.name).length <= 20);
}

// ---- O-Level / A-Level ---------------------------------------------------------

const SUBJECTS = [
  'Mathematics', 'Sub-Mathematics', 'Subsidiary Mathematics', 'English Language', 'English', 'Literature in English', 'Literature',
  'Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'Economics', 'Entrepreneurship', 'Commerce', 'Accounts',
  'Principles of Accounts', 'Agriculture', 'Fine Art', 'Art', 'Christian Religious Education', 'CRE', 'Islamic Religious Education', 'IRE',
  'Divinity', 'Kiswahili', 'French', 'German', 'Luganda', 'Computer Studies', 'Computer', 'ICT', 'Sub-ICT', 'General Paper',
  'Technical Drawing', 'Physical Education', 'Food and Nutrition', 'Political Education', 'Music', 'Woodwork', 'Metalwork'
];
const SUBJECT_RE = new RegExp(`\\b(${SUBJECTS.map((s) => s.replace(/[-]/g, '[- ]?')).sort((a, b) => b.length - a.length).join('|')})\\b\\s*[:\\-–|.]*\\s*\\(?\\s*(D1|D2|C3|C4|C5|C6|P7|P8|F9|[1-9]|[ABCDEOF])\\b`, 'gi');

function parseGrades(lines, level) {
  const grades = [];
  for (const line of lines) {
    SUBJECT_RE.lastIndex = 0;
    let m;
    while ((m = SUBJECT_RE.exec(line))) {
      const raw = m[2].toUpperCase();
      let grade = null;
      if (level === 'OLevel') grade = /^[DCPF]\d$/.test(raw) ? raw[1] : (/^[1-9]$/.test(raw) ? raw : null);
      else grade = /^[ABCDEOF]$/.test(raw) ? raw : null;
      if (grade) grades.push({ level, subject: m[1].replace(/\s+/g, ' '), grade });
    }
  }
  return grades;
}

// ---- Personal details --------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RES = [/(?:\+?\s?256|\b0)[\s-]?\(?7\d{2}\)?[\s-]?\d{3}[\s-]?\d{3}\b/, /(?:\+?\s?256|\b0)[\s-]?[34]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/, /\+?\d[\d\s()-]{8,}\d/];
const LINKEDIN_RE = /(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/(in|pub)\/[A-Za-z0-9\-_%/]+/i;
const URL_RE = /\b((https?:\/\/|www\.)[^\s|,;]+|(github\.com|gitlab\.com|behance\.net)\/[^\s|,;]+)/i;
const NIN_RE = /\b(C[MF][A-Z0-9]{12})\b/i;

function labelled(lines, labelRe) {
  for (const line of lines) {
    const m = line.match(new RegExp(`(?:^|\\|\\s*)(?:${labelRe.source})\\s*[:\\-–]\\s*([^|]+)`, 'i'));
    if (m && m[m.length - 1].trim()) return m[m.length - 1].trim();
  }
  return '';
}

function personalDetails(lines, text) {
  const top = lines.filter(Boolean);
  const details = {};
  const email = text.match(EMAIL_RE);
  if (email) details.email = email[0];
  for (const re of PHONE_RES) {
    const m = (text.match(new RegExp(re.source, 'g')) || [])
      .find((p) => p.replace(/\D/g, '').length >= 9 && !/^\s*(19|20)\d{2}\s*-\s*(19|20)\d{2}\s*$/.test(p));
    if (m) { details.phone = m.replace(/\s+/g, ' ').trim(); break; }
  }
  const linkedin = text.match(LINKEDIN_RE);
  if (linkedin) details.linkedinUrl = linkedin[0].startsWith('http') ? linkedin[0] : `https://${linkedin[0].replace(/^\/+/, '')}`;
  const url = text.replace(LINKEDIN_RE, ' ').replace(new RegExp(EMAIL_RE.source, 'g'), ' ').match(URL_RE);
  if (url) details.portfolioUrl = url[0].replace(/[).]+$/, '');

  const nin = labelled(top, /nin|national\s+id(entification)?(\s+(no|number))?\.?|national\s+identification\s+number|id\s+no\.?/).match(NIN_RE) || text.match(NIN_RE);
  if (nin) details.nationalId = nin[1].toUpperCase();

  const dob = labelled(top, /date\s+of\s+birth|d\.?\s?o\.?\s?b\.?|birth\s+date|born(\s+on)?/);
  const dobDate = dob && readDate(dob);
  if (dobDate && dobDate.year <= thisYear() - 15) details.dateOfBirth = dobDate.iso;

  const district = labelled(top, /district\s+of\s+origin|home\s+district|district\s+of\s+birth|origin(al)?\s+district|district/);
  if (district) details.districtOfOrigin = clean(district.replace(/\bdistrict\b/i, '')).slice(0, 100);

  const residence = labelled(top, /place\s+of\s+residence|residence|residential\s+address|physical\s+address|current\s+address|home\s+address|address|location|lives\s+in|resident\s+(of|at)/);
  if (residence && !EMAIL_RE.test(residence) && !/^p\.?\s?o\.?\s+box/i.test(residence)) details.location = clean(residence).slice(0, 120);

  // The name: an early line of two to five capitalised words, nothing else.
  const nameLabel = labelled(top.slice(0, 15), /(full\s+)?name(s)?|surname/);
  const nameLine = nameLabel || top.slice(0, 6).find((l) => /^[A-Za-z][A-Za-z.' -]+$/.test(l) && words(l).length >= 2 && words(l).length <= 5
    && words(l).every((w) => /^[A-Z]/.test(w)) && !headingOf(l) && !TITLE_RE.test(l) && !ORG_RE.test(l));
  if (nameLine) details.fullName = recase(clean(nameLine));
  return details;
}

// ---- Putting it together -----------------------------------------------------------

function warningsFor(result, found) {
  const warnings = [];
  if (!found) warnings.push('The CV has no headings we recognise, so its sections were guessed - check everything carefully.');
  if (!result.education.length) warnings.push('No qualifications could be read - please add them yourself.');
  if (!result.workExperience.length) warnings.push('No jobs could be read - please add them yourself.');
  result.education.forEach((e) => {
    if (!e.institution) warnings.push(`The institution of your ${e.qualificationLevel.toLowerCase()} could not be read - please fill it in.`);
    if (!e.fieldOfStudy) warnings.push(`The field of study of your ${e.qualificationLevel.toLowerCase()} could not be read - please fill it in.`);
  });
  result.workExperience.forEach((w) => {
    const what = w.jobTitle || w.employer;
    if (!w.employer) warnings.push(`The employer for "${what}" could not be read - please fill it in.`);
    if (!w.jobTitle) warnings.push(`The job title at ${what} could not be read - please fill it in.`);
    if (!w.startDate) warnings.push(`The dates of "${what}" could not be read - please fill them in.`);
  });
  if (result.workExperience.some((w) => w.yearOnly)) {
    warnings.push('Where the CV gives only a year, the date is set to 1 January - correct it if you know the month.');
  }
  result.workExperience.forEach((w) => { delete w.yearOnly; });
  return warnings;
}

function extractFieldsFromText(text) {
  const lines = toLines(text);
  const { sections, found } = splitSections(lines);

  // Without headings, look through the whole CV.
  const all = lines;
  const eduLines = sections.education.length ? sections.education : (found ? [] : all.filter((l) => !l || qualificationOf(l) || INSTITUTION_RE.test(l)));
  const workLines = sections.workExperience.length ? sections.workExperience : (found ? [] : all);

  let education = parseEducation(eduLines);
  // Qualifications listed under "Certifications" (a Diploma, say) stay certificates;
  // a degree there is education.
  let certificates = parseCertificates(sections.certificates);
  const degreeCerts = certificates.filter((c) => /^(PhD|Masters|Bachelors|Postgraduate)$/.test((qualificationOf(c.name) || {}).level || ''));
  if (degreeCerts.length) {
    certificates = certificates.filter((c) => !degreeCerts.includes(c));
    education = education.concat(parseEducation(degreeCerts.map((c) => `${c.name}${c.issuingOrganization ? `, ${c.issuingOrganization}` : ''}${c.issueDate ? ` ${c.issueDate.slice(0, 4)}` : ''}`)));
  }
  let workExperience = parseWork(workLines);
  if (!sections.workExperience.length) workExperience = workExperience.filter((w) => w.startDate && (TITLE_RE.test(w.jobTitle) || ORG_RE.test(w.employer)));

  // O-Level / A-Level results: their own sections, or listed under education.
  const examGrades = [
    ...parseGrades(sections.oLevel, 'OLevel'),
    ...parseGrades(sections.aLevel, 'ALevel')
  ];
  for (const block of blocksByBlank(sections.education)) {
    const level = block.some((l) => /\b(uace|a[\s'-]?level|advanced level)/i.test(l)) ? 'ALevel'
      : block.some((l) => /\b(uce|o[\s'-]?level|ordinary level|uganda certificate of education)/i.test(l)) ? 'OLevel' : null;
    if (level) examGrades.push(...parseGrades(block, level));
  }

  const personal = personalDetails([...lines.slice(0, 40), ...sections.other], tidy(text));
  const result = {
    ...personal,
    email: personal.email || '',
    phone: personal.phone || '',
    linkedinUrl: personal.linkedinUrl || '',
    education: dedupeBy(education, educationKey),
    workExperience: dedupeBy(workExperience, workExperienceKey),
    certificates: dedupeBy(certificates, certificateKey),
    examGrades: dedupeBy(examGrades, (g) => `${g.level}|${g.subject.toLowerCase()}`)
  };
  result.warnings = warningsFor(result, found);
  return result;
}

module.exports = { extractFieldsFromText, readRange, readDate, headingOf, toLines };
