const EDUCATION_RANK = { Certificate: 1, Diploma: 2, Bachelors: 3, Masters: 4, PhD: 5 };

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
    !highest || EDUCATION_RANK[e.qualificationLevel] > EDUCATION_RANK[highest] ? e.qualificationLevel : highest
  , null);
}

// Never auto-hides or rejects - always returns a result, never throws.
// HR sees every application regardless of outcome; this only informs
// what they see, never what they're allowed to see.
function screenApplication(application, candidate, vacancy) {
  const reasons = [];

  // Completeness (#1) - the CV check is expected to always pass, since
  // submit() already requires a CV before an application can leave Draft.
  // Kept here anyway for defensive completeness in case this function is
  // ever reused against data that didn't go through that gate.
  if (!application.cvUrl) reasons.push('Missing CV');
  if (!candidate.education || candidate.education.length === 0) reasons.push('No education record on file');
  if (!candidate.workExperience || candidate.workExperience.length === 0) reasons.push('No work experience record on file');

  // Structured criteria (#2) - only checked when the vacancy actually
  // specifies a requirement; a vacancy with no minimum set imposes none.
  if (vacancy.minimumEducationLevel) {
    const highest = highestEducationLevel(candidate.education || []);
    if (!highest || EDUCATION_RANK[highest] < EDUCATION_RANK[vacancy.minimumEducationLevel]) {
      reasons.push(`Below minimum education level (requires ${vacancy.minimumEducationLevel}${highest ? `, has ${highest}` : ''})`);
    }
  }

  if (vacancy.minimumExperienceYears) {
    const years = computeExperienceYears(candidate.workExperience || []);
    if (years < vacancy.minimumExperienceYears) {
      reasons.push(`Below minimum experience (${years.toFixed(1)} yrs vs ${vacancy.minimumExperienceYears} required)`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}

module.exports = { computeExperienceYears, highestEducationLevel, screenApplication, EDUCATION_RANK };
