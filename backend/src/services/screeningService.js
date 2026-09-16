const { meetsGrade, A_LEVEL_RANK } = require('../utils/examGrading');
const { countCompleteReferees } = require('../utils/referees');

// Matches EducationLevel's declared order in schema.prisma exactly.
const EDUCATION_RANK = {
  OLevel: 1, ALevel: 2, Certificate: 3, Diploma: 4, Bachelors: 5, Postgraduate: 6, Masters: 7, PhD: 8
};

// Caps how many points a single very-long-tenured candidate's experience
// (or, below, an unusually high flying-hours total) can contribute, so one
// outlier doesn't dwarf every other factor in the score below.
const EXPERIENCE_SCORE_CAP_YEARS = 5;
const FLYING_HOURS_SCORE_CAP = 5;
const CGPA_SCORE_CAP = 2; // CGPA is a 0-5 scale, not years/hours - a smaller cap keeps one
                          // strong transcript from outweighing every other factor here.

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

// Age in full years as of `asOf` - the deadline if the vacancy has one
// ("26 years or less at the time of the deadline", matching real UCAA
// advert wording), otherwise today. Two independent bounds, either or
// both may be set; each is only checked if set.
function computeAge(dateOfBirth, asOf) {
  const dob = new Date(dateOfBirth);
  let age = asOf.getFullYear() - dob.getFullYear();
  const hadBirthdayThisYear = asOf.getMonth() > dob.getMonth() ||
    (asOf.getMonth() === dob.getMonth() && asOf.getDate() >= dob.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

function evaluateAge(candidate, vacancy) {
  if (!vacancy.minimumAge && !vacancy.maximumAge) return null;
  if (!candidate.dateOfBirth) return { status: 'missing', age: null };
  const asOf = vacancy.deadline ? new Date(vacancy.deadline) : new Date();
  const age = computeAge(candidate.dateOfBirth, asOf);
  if (vacancy.minimumAge && age < vacancy.minimumAge) return { status: 'below', age };
  if (vacancy.maximumAge && age > vacancy.maximumAge) return { status: 'above', age };
  return { status: 'meets', age };
}

// Same role as evaluateExperience, for flying hours - a separate,
// aviation-specific minimum most vacancies never set.
function evaluateFlyingHours(candidate, vacancy) {
  if (!vacancy.minimumFlyingHours) return null;
  if (candidate.flyingHours == null) return { status: 'missing', hours: null, diff: null };
  const diff = candidate.flyingHours - vacancy.minimumFlyingHours;
  return { status: diff < 0 ? 'below' : diff === 0 ? 'meets' : 'exceeds', hours: candidate.flyingHours, diff };
}

// Same role as evaluateFlyingHours, for CGPA - takes the best (highest)
// cgpa across every Education row rather than requiring a specific one,
// same "don't make HR pick which qualification counts" reasoning as
// highestEducationLevel above.
function evaluateCGPA(educationRows, minimumCGPA) {
  if (!minimumCGPA) return null;
  // Number(null) and Number(undefined ?? '') coerce to 0 / NaN
  // respectively, not "absent" - filter on the raw value first so a row
  // with no cgpa recorded is correctly treated as missing rather than as
  // a real 0.0.
  const values = (educationRows || [])
    .map((e) => e.cgpa)
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter((v) => Number.isFinite(v));
  if (values.length === 0) return { status: 'missing', cgpa: null, diff: null };
  const best = Math.max(...values);
  const diff = best - minimumCGPA;
  return { status: diff < 0 ? 'below' : diff === 0 ? 'meets' : 'exceeds', cgpa: best, diff };
}

// One row per required subject, each independently checked against the
// candidate's ExamGrade rows for that level+subject - a retake shouldn't
// count against them, so the best grade on file wins regardless of order.
// Unlike evaluateEducation/evaluateExperience/evaluateAge/
// evaluateFlyingHours (one comparison in, one status out), this already
// returns a list, since "required exam grades" is itself a list on the
// vacancy - screenApplication/evaluateEssentialCriteria both iterate it
// directly rather than each re-deriving the per-subject shape.
function evaluateExamGrades(examGradeRows, requiredExamGrades) {
  return (requiredExamGrades || []).map((req) => {
    const candidateRows = (examGradeRows || []).filter((g) =>
      g.level === req.level && g.subject.trim().toLowerCase() === req.subject.trim().toLowerCase()
    );
    if (candidateRows.length === 0) return { ...req, status: 'missing', candidateGrade: null };

    const passing = candidateRows.find((g) => meetsGrade(req.level, g.grade, req.minGrade));
    if (passing) return { ...req, status: 'meets', candidateGrade: passing.grade };

    // Doesn't meet the bar - still report the best grade actually on
    // file (not just the first row) so HR sees what was achieved.
    const best = req.level === 'OLevel'
      ? candidateRows.reduce((b, g) => (Number(g.grade) < Number(b.grade) ? g : b))
      : candidateRows.reduce((b, g) => (A_LEVEL_RANK[g.grade] > A_LEVEL_RANK[b.grade] ? g : b));
    return { ...req, status: 'below', candidateGrade: best.grade };
  });
}

// Never auto-hides or rejects - always returns a result, never throws.
// HR sees every application regardless of outcome; this only informs
// what they see, never what they're allowed to see.
function screenApplication(application, candidate, vacancy) {
  const reasons = [];
  const educationRows = candidate.education || [];
  const workRows = candidate.workExperience || [];

  // Completeness (#1) - the referees check is expected to always pass,
  // since submit() already requires three complete referees before an
  // application can leave Draft. Kept here anyway for defensive
  // completeness in case this function is ever reused against data that
  // didn't go through that gate.
  if (countCompleteReferees(application.referees) < 3) reasons.push('Missing referees');
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

  const age = evaluateAge(candidate, vacancy);
  if (age) {
    if (age.status === 'missing') reasons.push('Date of birth not on file - could not verify age requirement');
    else if (age.status === 'below') reasons.push(`Below minimum age (requires ${vacancy.minimumAge}+, is ${age.age})`);
    else if (age.status === 'above') reasons.push(`Above maximum age (requires ${vacancy.maximumAge} or under, is ${age.age})`);
  }

  const flyingHours = evaluateFlyingHours(candidate, vacancy);
  if (flyingHours) {
    if (flyingHours.status === 'missing') reasons.push('Flying hours not on file - could not verify minimum flying hours requirement');
    else if (flyingHours.status === 'below') reasons.push(`Below minimum flying hours (requires ${vacancy.minimumFlyingHours}, has ${flyingHours.hours})`);
  }

  evaluateExamGrades(candidate.examGrades, vacancy.requiredExamGrades).forEach((r) => {
    const levelLabel = r.level === 'OLevel' ? 'O-Level' : 'A-Level';
    if (r.status === 'missing') reasons.push(`No ${levelLabel} grade on file for ${r.subject}`);
    else if (r.status === 'below') reasons.push(`Below required ${levelLabel} grade in ${r.subject} (requires ${r.minGrade}, has ${r.candidateGrade})`);
  });

  const cgpa = evaluateCGPA(educationRows, vacancy.minimumCGPA);
  if (cgpa) {
    if (cgpa.status === 'missing') reasons.push('CGPA not on file - could not verify minimum CGPA requirement');
    else if (cgpa.status === 'below') reasons.push(`Below minimum CGPA (requires ${vacancy.minimumCGPA}, has ${cgpa.cgpa})`);
  }

  // Hard eligibility gate (#3) - unlike desirableResponses, a mismatch
  // here DOES fail screening. text/requiredAnswer/answerType/minValue are
  // read off the snapshot taken at answer time (see
  // Application.disqualifyingResponses' schema comment), not off the
  // vacancy's current wording, so an already-screened application's result
  // never silently shifts under a later edit to the question. A 'yesno'
  // row (or any row from before 'number' existed, which has no
  // answerType) is compared against requiredAnswer as before; a 'number'
  // row instead fails whenever the answer is missing or below minValue.
  for (const response of application.disqualifyingResponses || []) {
    if (response.answerType === 'number') {
      const value = Number(response.answer);
      if (!Number.isFinite(value) || value < Number(response.minValue)) {
        reasons.push(`Disqualifying requirement not met: "${response.text}"`);
      }
    } else {
      const requiredBool = response.requiredAnswer !== 'No';
      if (response.answer !== requiredBool) {
        reasons.push(`Disqualifying requirement not met: "${response.text}"`);
      }
    }
  }

  // Soft signal (#4) - deliberately excluded from `reasons`/`passed` since
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

  const age = evaluateAge(candidate, vacancy);
  if (age) {
    let detail;
    if (age.status === 'missing') detail = 'Date of birth not on file';
    else if (age.status === 'below') detail = `Below minimum (is ${age.age})`;
    else if (age.status === 'above') detail = `Above maximum (is ${age.age})`;
    else detail = `Meets requirement (is ${age.age})`;

    results.push({
      key: 'age',
      label: 'Age',
      requirement: [vacancy.minimumAge ? `min ${vacancy.minimumAge}` : null, vacancy.maximumAge ? `max ${vacancy.maximumAge}` : null]
        .filter(Boolean).join(', '),
      met: age.status === 'meets',
      detail
    });
  }

  const flyingHours = evaluateFlyingHours(candidate, vacancy);
  if (flyingHours) {
    let detail;
    if (flyingHours.status === 'missing') detail = 'No flying hours on file';
    else if (flyingHours.status === 'below') detail = `Below minimum (has ${flyingHours.hours})`;
    else if (flyingHours.status === 'meets') detail = `Meets minimum exactly (${flyingHours.hours})`;
    else {
      const credited = Math.min(flyingHours.diff, FLYING_HOURS_SCORE_CAP);
      detail = `Exceeds minimum (${flyingHours.hours}) - +${credited} to shortlist score${credited < flyingHours.diff ? ', capped' : ''}`;
    }

    results.push({
      key: 'flyingHours',
      label: 'Minimum flying hours',
      requirement: `${vacancy.minimumFlyingHours} hour(s)`,
      met: flyingHours.status === 'meets' || flyingHours.status === 'exceeds',
      detail
    });
  }

  evaluateExamGrades(candidate.examGrades, vacancy.requiredExamGrades).forEach((r) => {
    const levelLabel = r.level === 'OLevel' ? 'O-Level' : 'A-Level';
    let detail;
    if (r.status === 'missing') detail = `No ${levelLabel} grade on file for ${r.subject}`;
    else if (r.status === 'below') detail = `Below required grade (has ${r.candidateGrade})`;
    else detail = `Meets required grade (has ${r.candidateGrade})`;

    results.push({
      key: `examGrade-${r.id}`,
      label: `${levelLabel}: ${r.subject}`,
      requirement: r.minGrade,
      met: r.status === 'meets',
      detail
    });
  });

  const cgpa = evaluateCGPA(educationRows, vacancy.minimumCGPA);
  if (cgpa) {
    let detail;
    if (cgpa.status === 'missing') detail = 'No CGPA on file';
    else if (cgpa.status === 'below') detail = `Below minimum (has ${cgpa.cgpa})`;
    else if (cgpa.status === 'meets') detail = `Meets minimum exactly (${cgpa.cgpa})`;
    else {
      const credited = Math.min(cgpa.diff, CGPA_SCORE_CAP);
      detail = `Exceeds minimum (${cgpa.cgpa}) - +${credited.toFixed(1)} to shortlist score${credited < cgpa.diff ? ', capped' : ''}`;
    }

    results.push({
      key: 'cgpa',
      label: 'Minimum CGPA',
      requirement: vacancy.minimumCGPA,
      met: cgpa.status === 'meets' || cgpa.status === 'exceeds',
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

  // Credit for flying hours beyond the stated minimum, same capping
  // reasoning as experience. Age and exam grades deliberately get no
  // credit here - a pass/fail bound (age) or a required grade already met
  // (exam grade) has no "how much better" direction the way years/hours
  // above a minimum does.
  const flyingHours = evaluateFlyingHours(candidate, vacancy);
  if (flyingHours && flyingHours.status === 'exceeds') {
    const capped = Math.min(flyingHours.diff, FLYING_HOURS_SCORE_CAP);
    score += capped;
    reasons.push(
      `+${capped} flying hours exceed minimum (${flyingHours.hours} vs ${vacancy.minimumFlyingHours} required` +
      `${capped < flyingHours.diff ? `, capped at ${FLYING_HOURS_SCORE_CAP}` : ''})`
    );
  }

  // Credit for CGPA beyond the stated minimum, same capping reasoning as
  // experience/flying hours. Age and exam grades still get no credit here -
  // see the comment above flyingHours for why.
  const cgpa = evaluateCGPA(educationRows, vacancy.minimumCGPA);
  if (cgpa && cgpa.status === 'exceeds') {
    const capped = Math.min(cgpa.diff, CGPA_SCORE_CAP);
    score += capped;
    reasons.push(
      `+${capped.toFixed(1)} CGPA exceeds minimum (${cgpa.cgpa} vs ${vacancy.minimumCGPA} required` +
      `${capped < cgpa.diff ? `, capped at ${CGPA_SCORE_CAP}` : ''})`
    );
  }

  // Desirable Requirements are preferences the vacancy itself defines, so
  // meeting more of them is a real, direct ranking signal - 1 point per
  // met question, same weight as one level of education or one year of
  // experience above minimum, deliberately kept simple and explainable. A
  // 'yesno' row (or any row with no answerType, from before 'number'
  // existed) counts as met on answer === true; a 'number' row counts as
  // met once the answer reaches its own snapshotted minValue.
  const desirable = (application.desirableResponses || []).filter((r) => {
    if (!r) return false;
    if (r.answerType === 'number') return typeof r.answer === 'number' && Number.isFinite(r.answer) && r.answer >= Number(r.minValue);
    return r.answer === true;
  });
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
  computeAge, evaluateAge, evaluateFlyingHours, evaluateExamGrades, evaluateCGPA,
  screenApplication, scoreApplication, evaluateEssentialCriteria, EDUCATION_RANK
};
