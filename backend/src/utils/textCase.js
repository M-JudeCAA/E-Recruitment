// How names and titles are cased when they are saved, whatever way they were
// typed. Mirrored in frontend/src/utils/textCase.js.
//
// The rule per kind of field:
//   code   UPPER CASE (directorate/department/position codes, NIN)
//   email  lower case
//   name   a person's name
//   title  a name of something - a position, department, institution,
//          employer, field of study, qualification
//   text   anything someone wrote (letters, answers, advert wording):
//          never changed, only trimmed
//
// A name or title is only re-cased when it was typed ALL IN CAPITALS or all
// in lower case - "JANE NAKATO" or "jane nakato". Anything typed in mixed
// case is kept exactly, so "McDonald", "van der Merwe" and "iOS Developer"
// survive. Acronyms on the KEEP list keep their own form ("ICT Officer",
// not "Ict Officer"); extend it when one is missing.

const KEEP = [
  // UCAA and Uganda
  'UCAA', 'CAA', 'DG', 'DDG', 'DHRA', 'EXCO', 'URA', 'NSSF', 'NIRA', 'UNRA', 'KCCA', 'UPDF', 'UPF', 'UCE', 'UACE', 'PLE', 'NIN', 'UNEB',
  'EAC', 'UN', 'UK', 'USA', 'UAE', 'EU', 'ICAO', 'IATA', 'ACI', 'FAA', 'EASA',
  // Aviation
  'ATC', 'ATM', 'ATS', 'CNS', 'AIS', 'AIM', 'MET', 'ARFF', 'AVSEC', 'SAR', 'NOTAM', 'ILS', 'VOR', 'DME', 'ADS-B', 'PBN', 'AMO', 'AOC', 'CPL', 'ATPL', 'PPL',
  // Functions and qualifications
  'HR', 'HRM', 'ICT', 'IT', 'IS', 'PR', 'QA', 'QMS', 'ISO', 'CEO', 'CFO', 'COO', 'MD', 'GM',
  'MBA', 'BSc', 'MSc', 'BA', 'MA', 'BBA', 'BCom', 'LLB', 'LLM', 'PhD', 'PGD', 'CPA', 'ACCA', 'CIMA', 'CIPS', 'CIM', 'CCNA', 'CISA', 'CISSP', 'PMP',
  'BIT', 'BCS', 'BEng', 'MEng', 'IFRS', 'IPSAS',
  // Roman numerals
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII'
];
const KEEP_BY_LOWER = new Map(KEEP.map((w) => [w.toLowerCase(), w]));
// In a person's name only Roman numerals are kept ("John Okello II") - the
// surname Ma is not the degree MA.
const NUMERALS = new Set(['ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii']);

// Kept in lower case inside a title (never as its first word).
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'per', 'via']);
// Parts of a person's surname kept in lower case after the first name.
const NAME_PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'la', 'le', 'du', 'da', 'di', 'bin', 'binti', 'al']);

const hasLetters = (s) => /\p{L}/u.test(s);
const upperFirst = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

// Typed all in capitals or all in lower case - the only times we re-case.
function needsCasing(text) {
  if (!hasLetters(text)) return false;
  return text === text.toUpperCase() || text === text.toLowerCase();
}

// One word: an acronym from the list, or capitalised - with each part of a
// hyphenated or apostrophe'd word ("Nakato-Mukasa", "O'Brien") capitalised too.
function caseWord(word, { isFirst, kind, wasAllCaps }) {
  const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const lower = bare.toLowerCase();
  if (KEEP_BY_LOWER.has(lower) && (kind === 'title' || NUMERALS.has(lower))) return word.replace(bare, KEEP_BY_LOWER.get(lower));
  // An abbreviation in brackets typed in capitals, "(KCCA)" or "(LLB)": kept.
  if (wasAllCaps && /^\(.*\)$/.test(word) && bare.length <= 6) return word;
  // A word with no vowel in a title typed in capitals is an acronym ("NWSC").
  if (wasAllCaps && kind === 'title' && bare.length >= 2 && !/[aeiouy]/i.test(bare)) return word;
  if (!isFirst && kind === 'title' && SMALL.has(lower)) return word.toLowerCase();
  if (!isFirst && kind === 'name' && NAME_PARTICLES.has(lower)) return word.toLowerCase();
  return word.toLowerCase().replace(/(^|[-'’(/])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())
    // Mc/Mac surnames: "mcdonald" -> "McDonald".
    .replace(/^(\(?)(Mc)(\p{L})/u, (m, open, mc, ch) => open + mc + ch.toUpperCase());
}

function caseWords(text, kind) {
  const wasAllCaps = text === text.toUpperCase();
  // Capitals with no word longer than three letters are initials or
  // acronyms we don't know ("JMK", "EIC OJT"), and a single short word in a
  // title most likely one too ("KCCA"): left alone.
  const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  const known = (w) => KEEP_BY_LOWER.has(w.toLowerCase());
  if (wasAllCaps && words.every((w) => w.length <= 3 || known(w)) && !words.every(known)) return text;
  if (kind === 'title' && wasAllCaps && /^\p{L}{2,5}$/u.test(text) && !known(text)) return text;
  let first = true;
  return text.split(/(\s+)/).map((part) => {
    if (!part.trim()) return part;
    const out = caseWord(part, { isFirst: first, kind, wasAllCaps });
    first = false;
    return out;
  }).join('');
}

const squash = (value) => String(value).replace(/\s+/g, ' ').trim();

/** The value as it should be stored for this kind of field. Non-strings pass through. */
function formatAs(kind, value) {
  if (typeof value !== 'string') return value;
  if (kind === 'text') return value.trim();
  const v = squash(value);
  if (!v) return v;
  if (kind === 'code') return v.toUpperCase();
  if (kind === 'email') return v.toLowerCase();
  if ((kind === 'name' || kind === 'title') && needsCasing(v)) return caseWords(v, kind);
  return v;
}

/** A copy of obj with each field in `kinds` ({ field: kind }) formatted. */
function formatFields(obj, kinds) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const [field, kind] of Object.entries(kinds)) {
    if (field in out) out[field] = formatAs(kind, out[field]);
  }
  return out;
}

/**
 * Express middleware: formats these request-body fields before the handler
 * sees them. `kinds` is { field: kind }; a field holding an array of objects
 * takes { field: { inner: kind } } (referees, panel members).
 */
function casing(kinds) {
  return (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
      for (const [field, kind] of Object.entries(kinds)) {
        const value = req.body[field];
        if (typeof kind === 'object') {
          if (Array.isArray(value)) req.body[field] = value.map((row) => formatFields(row, kind));
          else if (value && typeof value === 'object') req.body[field] = formatFields(value, kind);
        } else if (field in req.body) {
          req.body[field] = formatAs(kind, value);
        }
      }
    }
    next();
  };
}

module.exports = { formatAs, formatFields, casing, needsCasing, KEEP };
