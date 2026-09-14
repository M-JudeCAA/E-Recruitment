const EDUCATION_RANK = { Certificate: 1, Diploma: 2, Bachelors: 3, Masters: 4, PhD: 5 };

// Caps how many points a single very-long-tenured candidate's experience
// can contribute, so one outlier doesn't dwarf every other factor in the
// score below.
const EXPERIENCE_SCORE_CAP_YEARS = 5;

// Merges overlapping/adjacent date ranges before summing, so two
// concurrent jobs (e.g. a part-time role held alongside a full-time one)
// don't double-count the calendar time that actually elapsed. A null
// endDate means "ongoing" - treated as running through `asOf`.
function computeExperienceYears(workExperiences, asOf = new Date()) {
  if (!workExperiences.length) return 0;

  const ranges = workExperiences
    .map((w) => ({ start: new Date(w.startDate), end: w.endDate ? new Date(w.endDate) : asOf }))
    .sort((a, b) => a.start - b.start);

  const merged = [ranges[0]];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (r.start <= last.end) {
      last.end = new Date(Math.max(last.end, r.end));
    } else {
      merged.push(r);
    }
  }

  const totalDays = merged.reduce((sum, r) => sum + (r.end - r.start) / (1000 * 60 * 60 * 24), 0);
  return totalDays / 365.25;
}

function highestEducationLevel(educations) {
  if (!educations.length) return null;
  return educations.reduce((highest, e) =>
    e.qualificationLevel && (!highest || EDUCATION_RANK[e.qualificationLevel] > EDUCATION_RANK[highest])
      ? e.qualificationLevel : highest
  , null);
}

// True/false only when there's something to compare; null means "can't
// tell" (no preference set, or candidate has no education row with a
// fieldOfStudy). Deliberately loose (substring, either direction, case-
// insensitive) since fieldOfStudy is free text on both sides - "Air
// Traffic Management" vs "Air Traffic Management Studies" should match,
// and a false negative here just costs HR a glance, not the candidate
// their application (see fieldOfStudyMatch's schema comment).
function matchesFieldOfStudy(educations, preferredFieldOfStudy) {
  if (!preferredFieldOfStudy) return null;
  const fields = (educations || []).map((e) => e.fieldOfStudy).filter(Boolean);
  if (!fields.length) return null;
  const preferred = preferredFieldOfStudy.trim().toLowerCase();
  return fields.some((f) => {
    const field = f.trim().toLowerCase();
    return field.includes(preferred) || preferred.includes(field);
  });
}

// Single source of truth for "how does this candidate's education compare
// to the vacancy's minimum" - screenApplication (pass/fail), scoreApplication
// (credit for exceeding it), and evaluateEssentialCriteria (the itemized
// breakdown shown to HR) all read off this same comparison, so the three
// can never quietly disagree with each other. Returns null when the
// vacancy sets no minimum - "imposes none", same convention used
// throughout this file.
function evaluateEducation(educationRows, minimumEducationLevel) {
  if (!minimumEducationLevel) return null;
  if (educationRows.length === 0) return { status: 'missing', highest: null, diff: null };
  const highest = highestEducationLevel(educationRows);
  // qualificationLevel is nullable on Education (see schema comment) - HR
  // hasn't classified any row into the ordered enum yet. That's a
  // data-quality gap, not evidence the candidate falls short.
  if (!highest) return { status: 'unmapped', highest: null, diff: null };
  const diff = EDUCATION_RANK[highest] - EDUCATION_RANK[minimumEducationLevel];
  return { status: diff < 0 ? 'below' : diff === 0 ? 'meets' : 'exceeds', highest, diff };
}

// Same role as evaluateEducation, for experience. No separate "missing"
// status needed - computeExperienceYears already returns 0 for an empty
// work-experience list, which naturally falls out as "below" (or "meets"
// for a vacancy with no real minimum, i.e. 0 years required).
function evaluateExperience(workRows, minimumExperienceYears) {
  if (!minimumExperienceYears) return null;
  const years = computeExperienceYears(workRows);
  const diff = years - minimumExperienceYears;
  return { status: diff < 0 ? 'below' : diff === 0 ? 'meets' : 'exceeds', years, diff };
}

// Never auto-hides or rejects - always returns a result, never throws.
// HR sees every application regardless of outcome; this only informs
// what they see, never what they're allowed to see.
function screenApplication(application, candidate, vacancy) {
  const reasons = [];
  const educationRows = candidate.education || [];
  const workRows = candidate.workExperience || [];

  // Completeness (#1) - the CV check is expected to always pass, since
  // submit() already requires a CV before an application can leave Draft.
  // Kept here anyway for defensive completeness in case this function is
  // ever reused against data that didn't go through that gate.
  if (!application.cvUrl) reasons.push('Missing CV');
  if (educationRows.length === 0) reasons.push('No education record on file');
  if (workRows.length === 0) reasons.push('No work experience record on file');

  // Structured criteria (#2) - only checked when the vacancy actually
  // specifies a requirement; a vacancy with no minimum set imposes none.
  const education = evaluateEducation(educationRows, vacancy.minimumEducationLevel);
  if (education) {
    if (education.status === 'unmapped') {
      reasons.push('Education on file has not been classified by level yet - minimum education requirement could not be verified');
    } else if (education.status === 'missing' || education.status === 'below') {
      reasons.push(`Below minimum education level (requires ${vacancy.minimumEducationLevel}${education.highest ? `, has ${education.highest}` : ''})`);
    }
  }

  const experience = evaluateExperience(workRows, vacancy.minimumExperienceYears);
  if (experience && experience.status === 'below') {
    reasons.push(`Below minimum experience (${experience.years.toFixed(1)} yrs vs ${vacancy.minimumExperienceYears} required)`);
  }

  // Soft signal (#3) - deliberately excluded from `reasons`/`passed` since
  // preferredFieldOfStudy is a preference, not a requirement (see the
  // fieldOfStudyMatch schema comment for why a miss shouldn't flip
  // screeningPassed).
  const fieldOfStudyMatch = matchesFieldOfStudy(educationRows, vacancy.preferredFieldOfStudy);

  return { passed: reasons.length === 0, reasons, fieldOfStudyMatch };
}

// Itemized, one-row-per-minimum-requirement breakdown - the essential-
// requirements counterpart to Application.desirableResponses, so HR sees
// exactly which mandatory criteria were checked and why, the same level
// of detail already given to the preferred/desirable ones, instead of a
// single collapsed "N flag(s)"/"Meets criteria" line. Only includes a row
// for a requirement the vacancy actually sets (consistent with
// screenApplication/scoreApplication's "no minimum set imposes none").
function evaluateEssentialCriteria(candidate, vacancy) {
  const results = [];
  const educationRows = candidate.education || [];
  const workRows = candidate.workExperience || [];

  const education = evaluateEducation(educationRows, vacancy.minimumEducationLevel);
  if (education) {
    let detail;
    if (education.status === 'missing') detail = 'No education record on file';
    else if (education.status === 'unmapped') detail = 'Education on file has not been classified by level yet';
    else if (education.status === 'below') detail = `Below minimum (has ${education.highest})`;
    else if (education.status === 'meets') detail = `Meets minimum exactly (${education.highest})`;
    else detail = `Exceeds minimum (has ${education.highest}) - +${education.diff} to shortlist score`;

    results.push({
      key: 'education',
      label: 'Minimum education level',
      requirement: vacancy.minimumEducationLevel,
      met: education.status === 'meets' || education.status === 'exceeds',
      detail
    });
  }

  const experience = evaluateExperience(workRows, vacancy.minimumExperienceYears);
  if (experience) {
    let detail;
    if (experience.status === 'below') detail = `Below minimum (${experience.years.toFixed(1)} yrs)`;
    else if (experience.status === 'meets') detail = `Meets minimum exactly (${experience.years.toFixed(1)} yrs)`;
    else {
      const credited = Math.min(experience.diff, EXPERIENCE_SCORE_CAP_YEARS);
      detail = `Exceeds minimum (${experience.years.toFixed(1)} yrs) - +${credited.toFixed(1)} to shortlist score${credited < experience.diff ? ', capped' : ''}`;
    }

    results.push({
      key: 'experience',
      label: 'Minimum experience',
      requirement: `${vacancy.minimumExperienceYears} year(s)`,
      met: experience.status === 'meets' || experience.status === 'exceeds',
      detail
    });
  }

  return results;
}

// A ranking signal, not a gate - every point here is additive credit for
// exceeding a minimum or matching a preference; nothing here ever
// subtracts, and a candidate who fails screening entirely can still score
// above zero. This only ever seeds the starting order of the drag-to-rank
// pool (see VacancyDetail.jsx); HR's manual reorder and the explicit "Save
// ranking" action always have the final word.
function scoreApplication(application, candidate, vacancy) {
  const reasons = [];
  let score = 0;
  const educationRows = candidate.education || [];
  const workRows = candidate.workExperience || [];

  // Credit for education beyond the stated minimum - same comparison
  // screenApplication uses (evaluateEducation), so "one level above"
  // always means the same thing in both places.
  const education = evaluateEducation(educationRows, vacancy.minimumEducationLevel);
  if (education && education.status === 'exceeds') {
    score += education.diff;
    reasons.push(`+${education.diff} education exceeds minimum (${education.highest} vs ${vacancy.minimumEducationLevel} required)`);
  }

  // Credit for experience beyond the stated minimum, capped so decades of
  // tenure don't swamp the other factors.
  const experience = evaluateExperience(workRows, vacancy.minimumExperienceYears);
  if (experience && experience.status === 'exceeds') {
    const capped = Math.min(experience.diff, EXPERIENCE_SCORE_CAP_YEARS);
    score += capped;
    reasons.push(
      `+${capped.toFixed(1)} experience exceeds minimum (${experience.years.toFixed(1)} yrs vs ${vacancy.minimumExperienceYears} required` +
      `${capped < experience.diff ? `, capped at ${EXPERIENCE_SCORE_CAP_YEARS}` : ''})`
    );
  }

  // Desirable Requirements are preferences the vacancy itself defines, so
  // meeting more of them is a real, direct ranking signal - 1 point per
  // "Yes", same weight as one level of education or one year of
  // experience above minimum, deliberately kept simple and explainable.
  const desirable = (application.desirableResponses || []).filter((r) => r && r.answer === true);
  if (desirable.length > 0) {
    score += desirable.length;
    reasons.push(`+${desirable.length} met ${desirable.length} desirable requirement(s)`);
  }

  // Field-of-study is a soft signal everywhere else in this service (see
  // matchesFieldOfStudy) - a miss costs nothing here either, only a match
  // adds.
  if (matchesFieldOfStudy(educationRows, vacancy.preferredFieldOfStudy)) {
    score += 1;
    reasons.push('+1 field of study matches the preferred field');
  }

  return { score, reasons };
}

module.exports = {
  computeExperienceYears, highestEducationLevel, matchesFieldOfStudy,
  screenApplication, scoreApplication, evaluateEssentialCriteria, EDUCATION_RANK
};
