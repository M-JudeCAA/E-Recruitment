// What a candidate must upload to back up what screening relies on (FR-ATS
// screening evidence). Screening itself still reads the profile and the
// answers - a candidate who doesn't meet a minimum is refused at submit as
// before - but a claim that passes it needs its proof attached:
//
//   - an age limit           -> a copy of the National ID (date of birth)
//   - minimum flying hours   -> logbook pages
//   - required exam grades   -> UCE/UACE result slips
//   - minimum experience     -> appointment letters / certificates of service
//   - minimum CGPA           -> the academic transcript
//   - any screening question HR marked "needs evidence", answered Yes (or a
//     number above 0)        -> the evidence HR described
//
// Minimum education is already covered by the required Academic documents.
//
// Academic evidence (the transcript, result slips, and a question's evidence
// that is an academic document - a degree certificate for "Do you hold a
// degree in ...?") is NOT uploaded twice (UAT-031): it is covered by the
// Academic documents, which the candidate describes against what is asked
// for. Such requirements come back with academic: true and are never
// "missing" here - the at-least-one Academic document rule covers them.
// Mirrored in frontend/src/utils/screeningEvidence.js - keep them in step.

const FIXED = {
  nationalId: { label: 'Proof of your date of birth', hint: 'A copy of your National ID or birth certificate, for the age requirement.' },
  flyingHours: { label: 'Pilot logbook - the pages showing your total flying hours', hint: 'For the minimum flying hours.' },
  examResults: { label: 'UCE / UACE result slips or certificates', hint: 'For the O-Level / A-Level grades this role requires.' },
  experience: { label: 'Proof of work experience', hint: 'Appointment letters or certificates of service covering the years of experience required.' },
  transcript: { label: 'Academic transcript showing your CGPA', hint: 'For the minimum CGPA.' }
};

const ACADEMIC_KEYS = new Set(['examResults', 'transcript']);
// A question's evidence is academic when HR said so (evidenceAcademic), or,
// on questions from before that choice, when its label names an academic
// document (the screening suggestions' labels all do).
const ACADEMIC_LABEL_RE = /\b(?:degree|diploma|transcripts?|academic|uce|uace|result\s+slips?|[oa][\s'-]?level|masters?|bachelor'?s?|phd)\b|^certificate$/i;

function questionIsAcademic(row) {
  if (typeof row?.evidenceAcademic === 'boolean') return row.evidenceAcademic;
  return ACADEMIC_LABEL_RE.test(String(row?.evidenceLabel || '').trim());
}

const KEY_RE = /^(nationalId|flyingHours|examResults|experience|transcript|question:[A-Za-z0-9-]{1,64})$/;
const MAX_LABEL = 150;

function questionKey(id) {
  return `question:${id}`;
}

function questionLabel(row) {
  return row.evidenceLabel || `Evidence for: "${row.text}"`;
}

function affirmative(answer) {
  return answer === true || (typeof answer === 'number' && answer > 0);
}

function questionsOf(vacancy) {
  return [...(vacancy.disqualifyingRequirements || []), ...(vacancy.desirableRequirements || [])].filter((r) => r?.evidenceRequired);
}

function fixedRequirements(vacancy) {
  const out = [];
  const add = (key) => out.push({ key, ...FIXED[key], academic: ACADEMIC_KEYS.has(key) });
  if (vacancy.minimumAge != null || vacancy.maximumAge != null) add('nationalId');
  if (vacancy.minimumFlyingHours != null && Number(vacancy.minimumFlyingHours) > 0) add('flyingHours');
  if (Array.isArray(vacancy.requiredExamGrades) && vacancy.requiredExamGrades.length > 0) add('examResults');
  if (vacancy.minimumExperienceYears != null && Number(vacancy.minimumExperienceYears) > 0) add('experience');
  if (vacancy.minimumCGPA != null && Number(vacancy.minimumCGPA) > 0) add('transcript');
  return out;
}

/**
 * The evidence required for this vacancy given the candidate's answers.
 * answers: { [questionId]: answer } (true/false, or a number).
 * Returns [{ key, label, hint }].
 */
function evidenceRequirements(vacancy, answers = {}) {
  const out = fixedRequirements(vacancy);
  for (const row of questionsOf(vacancy)) {
    if (affirmative(answers[row.id])) {
      out.push({ key: questionKey(row.id), label: questionLabel(row), hint: `You answered "${row.text}".`, academic: questionIsAcademic(row) });
    }
  }
  return out;
}

// The requirement an upload is filed under (whatever the answers), or null
// if this vacancy doesn't ask for it.
function requirementFor(vacancy, key) {
  const fixed = fixedRequirements(vacancy).find((r) => r.key === key);
  if (fixed) return fixed;
  const row = questionsOf(vacancy).find((r) => questionKey(r.id) === key);
  return row ? { key, label: questionLabel(row), hint: `You answered "${row.text}".`, academic: questionIsAcademic(row) } : null;
}

// { [id]: answer } from an application's snapshotted responses.
function answersOf(application) {
  const rows = [...(application?.disqualifyingResponses || []), ...(application?.desirableResponses || [])];
  return Object.fromEntries(rows.map((r) => [r.id, r.answer]));
}

// The evidence still missing, given the documents already attached.
// Academic requirements are covered by the Academic documents.
function missingEvidence(requirements, documents) {
  const have = new Set(documents.filter((d) => d.category === 'Evidence').map((d) => d.evidenceKey));
  return requirements.filter((r) => !r.academic && !have.has(r.key));
}

// The academic documents on an application: the Academic uploads, plus
// evidence filed under an academic requirement before it moved there (drafts
// from before UAT-031).
function academicDocuments(vacancy, documents) {
  const academicKey = (key) => Boolean(key) && Boolean(requirementFor(vacancy || {}, key)?.academic);
  return documents.filter((d) => d.category === 'Academic' || (d.category === 'Evidence' && academicKey(d.evidenceKey)));
}

module.exports = {
  evidenceRequirements, requirementFor, answersOf, missingEvidence, academicDocuments, questionIsAcademic, KEY_RE, MAX_LABEL, FIXED, affirmative
};
