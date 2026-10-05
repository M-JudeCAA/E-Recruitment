// What a candidate must upload to back up what screening relies on - mirrors
// backend/src/utils/screeningEvidence.js (keep them in step): the National ID
// for an age limit, logbook pages for flying hours, result slips for exam
// grades, proof of experience for a minimum, the transcript for a CGPA, and
// the evidence HR described for any question marked "needs evidence" that
// the candidate answered Yes (or with a number above 0).
const FIXED = {
  nationalId: { label: 'Copy of your National ID', hint: 'Shows your date of birth for the age requirement.' },
  flyingHours: { label: 'Pilot logbook - the pages showing your total flying hours', hint: 'For the minimum flying hours.' },
  examResults: { label: 'UCE / UACE result slips or certificates', hint: 'For the O-Level / A-Level grades this role requires.' },
  experience: { label: 'Proof of work experience', hint: 'Appointment letters or certificates of service covering the years of experience required.' },
  transcript: { label: 'Academic transcript showing your CGPA', hint: 'For the minimum CGPA.' }
};

const affirmative = (answer) => answer === true || (typeof answer === 'number' && answer > 0);

export function evidenceRequirements(vacancy, answers = {}) {
  if (!vacancy) return [];
  const out = [];
  const add = (key) => out.push({ key, ...FIXED[key] });
  if (vacancy.minimumAge != null || vacancy.maximumAge != null) add('nationalId');
  if (Number(vacancy.minimumFlyingHours) > 0) add('flyingHours');
  if (Array.isArray(vacancy.requiredExamGrades) && vacancy.requiredExamGrades.length > 0) add('examResults');
  if (Number(vacancy.minimumExperienceYears) > 0) add('experience');
  if (Number(vacancy.minimumCGPA) > 0) add('transcript');
  for (const row of [...(vacancy.disqualifyingRequirements || []), ...(vacancy.desirableRequirements || [])]) {
    if (row?.evidenceRequired && affirmative(answers[row.id])) {
      out.push({ key: `question:${row.id}`, label: row.evidenceLabel || `Evidence for: "${row.text}"`, hint: `You answered "${row.text}".` });
    }
  }
  return out;
}

export function missingEvidence(requirements, documents = []) {
  const have = new Set(documents.filter((d) => d.category === 'Evidence').map((d) => d.evidenceKey));
  return requirements.filter((r) => !have.has(r.key));
}
