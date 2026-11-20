// What a candidate must upload to back up what screening relies on - mirrors
// backend/src/utils/screeningEvidence.js (keep them in step): the National ID
// for an age limit, logbook pages for flying hours, result slips for exam
// grades, proof of experience for a minimum, the transcript for a CGPA, and
// the evidence HR described for any question marked "needs evidence" that
// the candidate answered Yes (or with a number above 0).
const FIXED = {
  nationalId: { label: 'Proof of your date of birth', hint: 'A copy of your National ID or birth certificate, for the age requirement.' },
  flyingHours: { label: 'Pilot logbook - the pages showing your total flying hours', hint: 'For the minimum flying hours.' },
  examResults: { label: 'UCE / UACE result slips or certificates', hint: 'For the O-Level / A-Level grades this role requires.' },
  experience: { label: 'Proof of work experience', hint: 'Appointment letters or certificates of service covering the years of experience required.' },
  transcript: { label: 'Academic transcript showing your CGPA', hint: 'For the minimum CGPA.' }
};

const affirmative = (answer) => answer === true || (typeof answer === 'number' && answer > 0);

// Academic evidence (transcript, result slips, a question's academic
// document) is covered by the Academic documents, not uploaded twice
// (UAT-031); such requirements carry academic: true.
const ACADEMIC_KEYS = new Set(['examResults', 'transcript']);
const ACADEMIC_LABEL_RE = /\b(?:degree|diploma|transcripts?|academic|uce|uace|result\s+slips?|[oa][\s'-]?level|masters?|bachelor'?s?|phd)\b|^certificate$/i;

export function questionIsAcademic(row) {
  if (typeof row?.evidenceAcademic === 'boolean') return row.evidenceAcademic;
  return ACADEMIC_LABEL_RE.test(String(row?.evidenceLabel || '').trim());
}

export function evidenceRequirements(vacancy, answers = {}) {
  if (!vacancy) return [];
  const out = [];
  const add = (key) => out.push({ key, ...FIXED[key], academic: ACADEMIC_KEYS.has(key) });
  if (vacancy.minimumAge != null || vacancy.maximumAge != null) add('nationalId');
  if (Number(vacancy.minimumFlyingHours) > 0) add('flyingHours');
  if (Array.isArray(vacancy.requiredExamGrades) && vacancy.requiredExamGrades.length > 0) add('examResults');
  if (Number(vacancy.minimumExperienceYears) > 0) add('experience');
  if (Number(vacancy.minimumCGPA) > 0) add('transcript');
  for (const row of [...(vacancy.disqualifyingRequirements || []), ...(vacancy.desirableRequirements || [])]) {
    if (row?.evidenceRequired && affirmative(answers[row.id])) {
      out.push({ key: `question:${row.id}`, label: row.evidenceLabel || `Evidence for: "${row.text}"`, hint: `You answered "${row.text}".`, academic: questionIsAcademic(row) });
    }
  }
  return out;
}

export function missingEvidence(requirements, documents = []) {
  const have = new Set(documents.filter((d) => d.category === 'Evidence').map((d) => d.evidenceKey));
  return requirements.filter((r) => !r.academic && !have.has(r.key));
}

// Academic documents: the Academic uploads, plus evidence filed under an
// academic requirement on drafts from before it moved there.
export function academicDocuments(requirements, documents = []) {
  const academicKeys = new Set(requirements.filter((r) => r.academic).map((r) => r.key));
  return documents.filter((d) => d.category === 'Academic' || (d.category === 'Evidence' && academicKeys.has(d.evidenceKey)));
}
