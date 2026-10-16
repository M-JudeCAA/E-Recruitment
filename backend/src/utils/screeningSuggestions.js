const crypto = require('crypto');

// What a requisition's Essential Requirements suggest screening should check,
// for HR to confirm on the vacancy form - nothing here is applied unseen.
//
//   - the education LEVEL (a degree, a diploma...) becomes the minimum
//     education, checked against the candidate's profile;
//   - years of experience become the minimum experience;
//   - the FIELD ("in Computer Science, Information Technology or
//     equivalent") can't be matched reliably by a computer, so it becomes a
//     Disqualifying question in the requirement's own words, answered Yes
//     with the certificate or transcript as evidence - and the committee
//     judges "equivalent" against it. The field is also kept as the
//     preferred field of study, which flags likely mismatches to HR.
//
// screensApplicants says whether a vacancy checks anything at all when
// candidates apply.

const LEVEL_RANK = { OLevel: 1, ALevel: 2, Certificate: 3, Diploma: 4, Bachelors: 5, Postgraduate: 6, Masters: 7, PhD: 8 };

// Most specific first; each match is blanked out so "Master's degree" isn't
// also read as a (bachelor's) "degree", nor "postgraduate diploma" as a diploma.
const LEVEL_PATTERNS = [
  ['PhD', /\b(?:ph\.?\s?d|doctorate|doctoral\s+degree)\b/gi],
  ['Masters', /\b(?:master'?s?|m\.?\s?sc|mba|m\.?\s?a\.)(?:\s+degree)?\b/gi],
  ['Postgraduate', /\bpost[\s-]?graduate(?:\s+(?:diploma|certificate|degree))?\b/gi],
  ['Bachelors', /\b(?:bachelor'?s?|b\.?\s?sc|honou?rs\s+degree|first\s+degree|undergraduate\s+degree)(?:\s+degree)?\b/gi],
  ['Diploma', /\bdiploma\b/gi],
  ['Certificate', /\bcertificate\b/gi],
  ['ALevel', /\b(?:a[\s'-]?level|uace|advanced\s+level)\b/gi],
  ['OLevel', /\b(?:o[\s'-]?level|uce|ordinary\s+level)\b/gi]
];

// Word writes "Master’s" with a curly apostrophe.
const plain = (text) => String(text || '').replace(/[‘’ʼ]/g, "'");

// The levels one requirement names, lowest first.
function levelsIn(text) {
  let rest = plain(text);
  const found = [];
  for (const [level, pattern] of LEVEL_PATTERNS) {
    if (pattern.test(rest)) found.push(level);
    pattern.lastIndex = 0;
    rest = rest.replace(pattern, ' ');
  }
  // A plain "degree", once no named level is left, is a bachelor's.
  if (/\bdegree\b/i.test(rest) && !found.includes('Bachelors')) found.push('Bachelors');
  return found.sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b]);
}

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const YEARS = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b(?:\s*\(\d{1,2}\))?\s*\+?[\s-]*years?\b/i;

// Years of experience one requirement asks for, or null.
function yearsIn(text) {
  if (!/experience/i.test(text || '')) return null;
  const m = YEARS.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1].toLowerCase()];
  return n > 0 && n <= 40 ? n : null;
}

// "in Computer Science, Information Technology or equivalent" - the field a
// qualification is in, or null when the requirement names none.
function fieldIn(text) {
  const t = plain(text).replace(/\s+/g, ' ');
  // "in marketing, MBA..." as well as "in Computer Science" - but not "in a
  // recognised institution" or "in any field".
  const m = /\bin\s+(?:the\s+(?:field|area)s?\s+of\s+)?(?!(?:a|an|the|any|one|addition|order|good)\b)([A-Za-z][^.;]*?)(?=\s+(?:from|with|plus|obtained|acquired)\b|[.;]|$)/i.exec(t)
    || /\bbachelor(?:'s)?\s+of\s+([A-Z][^.;,]*?)(?=\s+(?:from|with|plus)\b|[.;,]|$)/i.exec(t);
  const field = m?.[1]?.trim().replace(/,$/, '');
  return field && field.length >= 3 ? field : null;
}

// The field without "or equivalent" / "or a related field" - what the
// preferred-field note compares candidates' fields of study against.
const coreField = (field) => field.replace(/,?\s*(?:or|and\/or)\s+(?:any\s+)?(?:an?\s+)?(?:equivalent|other\s+)?(?:related|relevant)?\s*(?:field|discipline|area|qualification)?s?\s*$/i, '').trim()
  .replace(/,?\s*or\s+equivalent$/i, '').trim();

const EVIDENCE_LABEL = {
  PhD: 'Degree certificate or academic transcript', Masters: 'Degree certificate or academic transcript',
  Postgraduate: 'Certificate or academic transcript', Bachelors: 'Degree certificate or academic transcript',
  Diploma: 'Diploma certificate or transcript', Certificate: 'Certificate', ALevel: 'UACE result slip or certificate', OLevel: 'UCE result slip or certificate'
};

// "An honors bachelor's degree in X." -> "Do you hold an honors bachelor's degree in X?"
function questionFrom(text) {
  let phrase = plain(text).replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '')
    .replace(/^(?:possession\s+of|must\s+(?:have|hold|possess)|holder\s+of|should\s+(?:have|hold))\s+/i, '');
  phrase = /^(?:a|an|the)\s/i.test(phrase) ? phrase[0].toLowerCase() + phrase.slice(1) : `a ${phrase}`;
  return `Do you hold ${phrase}?`.slice(0, 500);
}

/**
 * Suggestions from the Essential Requirements bullets (string[]). Every key
 * is optional; `sources` holds the requirement each came from.
 */
function suggestScreening(essential) {
  const bullets = (Array.isArray(essential) ? essential : []).map((b) => plain(b).trim()).filter(Boolean);
  const out = { sources: {} };

  // A requirement may offer a choice ("a Master's, or a Bachelor's with...")
  // - its lowest level is the minimum. Several requirements all apply, so
  // the highest of those minimums wins.
  let education = null;
  for (const b of bullets) {
    const levels = levelsIn(b);
    if (levels.length && (!education || LEVEL_RANK[levels[0]] > LEVEL_RANK[education.level])) {
      education = { level: levels[0], text: b, alternatives: levels.length > 1 };
    }
  }
  if (education) {
    out.minimumEducationLevel = education.level;
    out.sources.education = education.text;
    const field = fieldIn(education.text);
    if (field) out.preferredFieldOfStudy = coreField(field) || field;
    // Where the requirement offers a choice of qualifications, a single Yes/No
    // question would turn away one of the routes it allows - HR words that one.
    if (field && !education.alternatives) {
      out.disqualifyingQuestion = {
        id: crypto.randomUUID(),
        text: questionFrom(education.text),
        requiredAnswer: 'Yes',
        evidenceRequired: true,
        evidenceLabel: EVIDENCE_LABEL[education.level]
      };
    }
  }

  // Experience asked for on its own. Years written into a qualification
  // ("a Bachelor's with 10 years' experience may be considered") belong to
  // that route only, so they are left for HR.
  for (const b of bullets.filter((x) => levelsIn(x).length === 0)) {
    const years = yearsIn(b);
    if (years && years > (out.minimumExperienceYears || 0)) {
      out.minimumExperienceYears = years;
      out.sources.experience = b;
    }
  }
  return out;
}

const filled = (v) => v !== null && v !== undefined && v !== '';

// Whether anything is checked when a candidate applies to this vacancy.
function screensApplicants(vacancy) {
  return ['minimumEducationLevel', 'minimumExperienceYears', 'minimumAge', 'maximumAge', 'minimumFlyingHours', 'minimumCGPA']
    .some((k) => filled(vacancy[k]))
    || (vacancy.requiredExamGrades || []).length > 0
    || (vacancy.disqualifyingRequirements || []).length > 0;
}

// What applying the suggestions to a vacancy that already exists changes
// (scripts/applyScreeningSuggestions.js): only fields still empty - nothing
// HR set is overwritten - and only while the vacancy is waiting for approval
// or still taking applications. { changes, notes, skipped }.
const ADVERTISED = ['PendingApproval', 'Returned', 'Open', 'PartiallyFilled'];
const MAX_QUESTIONS = 5; // vacancyValidation.MAX_SCREENING_QUESTIONS

function backfillFor(vacancy, now = new Date()) {
  if (!ADVERTISED.includes(vacancy.status)) return { skipped: `not being advertised (${vacancy.status})` };
  if (['Open', 'PartiallyFilled'].includes(vacancy.status) && vacancy.deadline && new Date(vacancy.deadline) < now) {
    return { skipped: 'applications have closed' };
  }
  const s = suggestScreening(vacancy.essentialRequirements);
  const changes = {};
  const notes = [];
  for (const key of ['minimumEducationLevel', 'minimumExperienceYears', 'preferredFieldOfStudy']) {
    if (!s[key]) continue;
    if (filled(vacancy[key])) notes.push(`kept the ${key} already set (${vacancy[key]})`);
    else changes[key] = s[key];
  }
  if (s.disqualifyingQuestion) {
    const disqualifying = vacancy.disqualifyingRequirements || [];
    const qualifying = vacancy.desirableRequirements || [];
    // HR may already ask about the qualification as a Qualifying question,
    // which never stops anyone: it becomes Disqualifying, in HR's words.
    const asked = qualifying.find((q) => q.answerType !== 'number' && levelsIn(q.text).length > 0);
    if (disqualifying.length) {
      notes.push('it already has a Disqualifying question, so no field question was added');
    } else if (asked) {
      changes.desirableRequirements = qualifying.filter((q) => q.id !== asked.id);
      changes.disqualifyingRequirements = [{
        id: asked.id, text: asked.text, requiredAnswer: 'Yes', evidenceRequired: true,
        evidenceLabel: asked.evidenceLabel || s.disqualifyingQuestion.evidenceLabel
      }];
      notes.push(`moved HR's question "${asked.text}" from Qualifying to Disqualifying`);
    } else if (qualifying.length >= MAX_QUESTIONS) {
      notes.push(`it already has ${MAX_QUESTIONS} screening questions, so no field question was added`);
    } else {
      changes.disqualifyingRequirements = [s.disqualifyingQuestion];
    }
  }
  if (!Object.keys(changes).length && !notes.length) return { skipped: 'nothing in its Essential Requirements could be turned into screening' };
  return { changes, notes };
}

module.exports = { suggestScreening, screensApplicants, backfillFor, levelsIn, yearsIn, fieldIn };
