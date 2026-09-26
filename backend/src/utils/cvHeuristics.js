// Best-effort keyword/regex extraction from raw CV text. Deliberately not
// aiming for high accuracy - this exists specifically for the
// "personal-layout CV" path, where the UI already warns the candidate
// that autofill may misread their layout and every field must be
// reviewed before saving. The "system template" path never calls this at
// all (it's just the structured form filled in directly).

const { educationKey, workExperienceKey, certificateKey, dedupeBy } = require('./entryDedup');

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d[\d\s()-]{7,}\d)/;
const LINKEDIN_RE = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-_/]+/i;
const YEAR_RE = /(19|20)\d{2}/g;
const INSTITUTION_RE = /[A-Z][A-Za-z.&' ]*(?:University|College|Institute|Polytechnic|School|SSS|Academy)[A-Za-z .&']*/;

const QUALIFICATION_KEYWORDS = [
  { level: 'PhD', pattern: /\bph\.?d\b|doctorate/i },
  { level: 'Masters', pattern: /\bmaster'?s?\b|\bmsc\b|\bm\.?a\.?\b|\bmba\b/i },
  { level: 'Bachelors', pattern: /\bbachelor'?s?\b|\bbsc\b|\bb\.?a\.?\b|\bb\.?eng\b/i },
  { level: 'Diploma', pattern: /\bdiploma\b/i },
  { level: 'Certificate', pattern: /\bcertificate\b/i }
];

const SECTION_HEADERS = {
  education: /^(academic\s+)?education(al\s+background)?:?$/i,
  workExperience: /^(work\s+|professional\s+)?(experience|employment history|career history|work history):?$/i,
  certifications: /^(professional\s+)?certificat(ions?|es)(\s+(&|and)\s+licen[cs]es)?:?$/i
};

function splitLines(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// Many resume templates render section headings with letter-spacing
// ("E D U C A T I O N", "P R O F E S S I O N A L   E X P E R I E N C E") -
// a single space between letters within a word, a wider gap (2+ spaces)
// between words. Collapsed back to normal spelling only when the WHOLE
// line fits that exact shape, so ordinary sentences are never touched.
const LETTER_SPACED_RE = /^[A-Za-z](\s[A-Za-z])*(\s{2,}[A-Za-z](\s[A-Za-z])*)*$/;
function collapseLetterSpacing(line) {
  if (!LETTER_SPACED_RE.test(line)) return line;
  return line.split(/\s{2,}/).map((word) => word.replace(/\s+/g, '')).join(' ');
}

// A short, punctuation-free, fully-uppercase line - used to recognize an
// unrecognized heading (e.g. "CERTIFICATIONS", "REFEREES") that should
// end whichever tracked section is currently active, so its content
// isn't misattributed to education/work experience.
function looksLikeHeading(normalizedLine) {
  const compact = normalizedLine.replace(/\s+/g, '');
  return compact.length > 0 && compact.length <= 35 && /^[A-Z]+$/.test(compact);
}

function groupBySection(lines) {
  const sections = { education: [], workExperience: [], certifications: [] };
  let current = null;
  for (const rawLine of lines) {
    const normalized = collapseLetterSpacing(rawLine);
    const matchedKey = Object.keys(SECTION_HEADERS).find((key) => SECTION_HEADERS[key].test(normalized));
    if (matchedKey) {
      current = matchedKey;
      continue;
    }
    if (current && looksLikeHeading(normalized)) {
      current = null;
      continue;
    }
    if (current) sections[current].push(rawLine);
  }
  return sections;
}

function guessQualificationLevel(line) {
  const found = QUALIFICATION_KEYWORDS.find((q) => q.pattern.test(line));
  return found ? found.level : null;
}

function parseEducationLines(lines) {
  const entries = [];
  const warnings = [];
  for (const line of lines) {
    const qualification = QUALIFICATION_KEYWORDS.find((q) => q.pattern.test(line));
    if (!qualification) continue;
    const years = line.match(YEAR_RE);
    const instMatch = line.match(INSTITUTION_RE);

    // Field of study: in a pipe-separated layout ("MSc Information Systems
    // | Uganda Martyrs University..."), prefer the degree segment before
    // the first "|" with the qualification wording stripped off ("MSc
    // Information Systems" -> "Information Systems"), cut short at any
    // trailing "(...)"/"—" clutter. Otherwise (a plain comma/"in"-style
    // line, e.g. "Bachelor of Science in Computer Science, University...")
    // fall back to the explicit "... in <field>" phrasing instead - the
    // pipe-based heuristic would otherwise swallow the whole rest of a
    // line that never had a pipe to bound it.
    let fieldOfStudy = '';
    if (line.includes('|')) {
      fieldOfStudy = line.split('|')[0].replace(qualification.pattern, '').split(/[—(]/)[0].trim().replace(/\s{2,}/g, ' ');
    }
    if (!fieldOfStudy) {
      const fieldMatch = line.match(/\bin\s+([A-Za-z][A-Za-z\s]{2,40})/i);
      fieldOfStudy = fieldMatch ? fieldMatch[1].trim() : '';
    }

    entries.push({
      institution: instMatch ? instMatch[0].trim() : '',
      qualificationLevel: qualification.level,
      fieldOfStudy,
      yearCompleted: years ? Number(years[years.length - 1]) : null
    });
  }
  // Two lines can legitimately describe the same entry (a wrapped line,
  // or the same heading matched by more than one heuristic) - deduped on
  // institution+level+field so the same credential isn't ever suggested
  // twice from a single parse, while two genuinely distinct entries at
  // the same institution (e.g. O-Level and A-Level certificates from one
  // school) are untouched since their fieldOfStudy differs.
  const deduped = dedupeBy(entries, educationKey);
  if (deduped.length === 0 && lines.length > 0) {
    warnings.push('Could not confidently identify education entries - please add them manually.');
  }
  deduped.forEach((e) => {
    if (!e.institution) warnings.push(`Institution not detected for a ${e.qualificationLevel} entry - please fill it in.`);
    if (!e.fieldOfStudy) warnings.push(`Field of study not detected for a ${e.qualificationLevel} entry - please fill it in.`);
  });
  return { entries: deduped, warnings };
}

// Strips a leading bullet glyph (-, •, *, ▪, ◦, ‣, ·) or a lone leading
// dash used as a plain-text bullet, so a stored duty reads as prose
// ("Managed the on-call rotation") rather than carrying the marker
// ("- Managed the on-call rotation").
function stripBulletMarker(line) {
  return line.replace(/^[-•*▪◦‣·]+\s*/, '').trim();
}

function parseWorkExperienceLines(lines) {
  const entries = [];
  const warnings = [];
  // A line containing a year starts a new role - every following line up
  // to the next such line is that role's duty/responsibility bullets
  // (the common resume shape: one title/employer/dates line, then a
  // handful of bullet points describing the role). A line with no active
  // role yet (nothing detected before the first date line) is dropped,
  // same as the pre-existing behavior.
  let current = null;
  for (const line of lines) {
    const years = line.match(YEAR_RE);
    if (!years) {
      if (current) {
        const duty = stripBulletMarker(line);
        if (duty) current.duties.push(duty);
      }
      continue;
    }
    const isCurrent = /present|current/i.test(line);

    // Common resume layout: "Job Title | Employer — Location Dates".
    // Without a pipe, fall back to everything before the first year as a
    // single best-guess title (the pre-existing, cruder behavior).
    let jobTitle = '';
    let employer = '';
    if (line.includes('|')) {
      const [left, right] = line.split('|').map((s) => s.trim());
      jobTitle = left;
      const employerMatch = right.match(/^([^—-]+)/);
      employer = (employerMatch ? employerMatch[1] : right).trim();
    } else {
      jobTitle = line.slice(0, line.indexOf(years[0])).trim().replace(/[-–—,|]+$/, '').trim();
    }

    current = {
      employer,
      jobTitle,
      startDate: years[0] ? `${years[0]}-01-01` : '',
      endDate: isCurrent || years.length < 2 ? '' : `${years[years.length - 1]}-01-01`,
      duties: []
    };
    entries.push(current);
  }
  // See parseEducationLines' comment above - same reasoning, deduped on
  // employer+jobTitle+startDate (duties aren't part of that key, so the
  // first occurrence's duty list - whichever is more complete or first
  // in the document - is the one kept).
  const deduped = dedupeBy(entries, workExperienceKey);
  if (deduped.length === 0 && lines.length > 0) {
    warnings.push('Could not confidently identify work experience entries - please add them manually.');
  }
  deduped.forEach((e) => {
    if (!e.employer) warnings.push('Employer not detected for a work experience entry - please fill it in.');
    if (!e.jobTitle) warnings.push('Job title not detected for a work experience entry - please fill it in.');
  });
  return { entries: deduped, warnings };
}

// Certificates are one-per-line (no duty bullets underneath), so unlike
// parseWorkExperienceLines this doesn't need block/current-pointer
// tracking - every non-empty line in the certifications section is
// treated as a single certificate.
function parseCertificateLines(lines) {
  const entries = [];
  const warnings = [];
  for (const line of lines) {
    const years = line.match(YEAR_RE);
    let name = line;
    let issuingOrganization = '';

    // Common layouts: "Name | Issuer (2021)" or "Name - Issuer, 2021".
    // Without either separator, fall back to the whole line (minus any
    // year/parentheses) as the name, same crude fallback used elsewhere
    // in this file when a layout can't be split confidently.
    if (line.includes('|')) {
      const [left, right] = line.split('|').map((s) => s.trim());
      name = left;
      issuingOrganization = right;
    } else if (line.includes(' - ')) {
      const [left, right] = line.split(/\s-\s/).map((s) => s.trim());
      name = left;
      issuingOrganization = right;
    } else if (line.includes(',')) {
      const [left, ...rest] = line.split(',');
      name = left.trim();
      issuingOrganization = rest.join(',').trim();
    }
    name = name.replace(YEAR_RE, '').replace(/[()]/g, '').trim().replace(/[-–—,]+$/, '').trim();
    issuingOrganization = issuingOrganization.replace(YEAR_RE, '').replace(/[()]/g, '').trim().replace(/[-–—,]+$/, '').trim();

    entries.push({
      name,
      issuingOrganization,
      issueDate: years && years[0] ? `${years[0]}-01-01` : '',
      expiryDate: years && years.length > 1 ? `${years[years.length - 1]}-01-01` : ''
    });
  }
  // See parseEducationLines' comment above - same reasoning, deduped on
  // name+issuingOrganization+issueDate (expiryDate isn't part of that key).
  const deduped = dedupeBy(entries, certificateKey);
  if (deduped.length === 0 && lines.length > 0) {
    warnings.push('Could not confidently identify certificate entries - please add them manually.');
  }
  deduped.forEach((e) => {
    if (!e.name) warnings.push('Certificate name not detected for an entry - please fill it in.');
  });
  return { entries: deduped, warnings };
}

function extractFieldsFromText(text) {
  const lines = splitLines(text);
  const sections = groupBySection(lines);

  const emailMatch = text.match(EMAIL_RE);
  const phoneMatch = text.match(PHONE_RE);
  const linkedinMatch = text.match(LINKEDIN_RE);

  const education = parseEducationLines(sections.education);
  const workExperience = parseWorkExperienceLines(sections.workExperience);
  const certificates = parseCertificateLines(sections.certifications);

  return {
    email: emailMatch ? emailMatch[0] : '',
    phone: phoneMatch ? phoneMatch[0].trim() : '',
    linkedinUrl: linkedinMatch ? linkedinMatch[0] : '',
    education: education.entries,
    workExperience: workExperience.entries,
    certificates: certificates.entries,
    warnings: [...education.warnings, ...workExperience.warnings, ...certificates.warnings]
  };
}

module.exports = { extractFieldsFromText };
