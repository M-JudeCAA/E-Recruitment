// Answers to the vacancy's questions, as [{ id, answer }], snapshotted
// against its questions as they stand now - server-side, never trusting the
// `text`/`answerType`/`minValue` a client sent alongside each answer (see the
// schema comments on Application.desirableResponses/disqualifyingResponses).
// A 'yesno' question (or one with no answerType, from before 'number'
// existed) takes a boolean, a 'number' one a finite number; unmatched or
// malformed answers are dropped. Taken at every draft save and again at
// submit (services/applicationSubmissionService.js), so the application is
// screened against the questions as they are when it is submitted - a
// question HR changed or removed after the draft was saved is never judged by
// its old wording or required answer.
const answerMatchesType = (requirement, answer) =>
  requirement.answerType === 'number' ? (typeof answer === 'number' && Number.isFinite(answer)) : typeof answer === 'boolean';

function snapshotAnswers(answers, requirements, extra) {
  const byId = new Map((requirements || []).map((r) => [r.id, r]));
  return (answers || [])
    .filter((r) => r && byId.has(r.id) && answerMatchesType(byId.get(r.id), r.answer))
    .map((r) => {
      const requirement = byId.get(r.id);
      return {
        id: r.id, text: requirement.text, ...extra(requirement), answer: r.answer,
        ...(requirement.answerType === 'number' ? { answerType: 'number', minValue: requirement.minValue } : {})
      };
    });
}

const snapshotDesirable = (answers, vacancy) => snapshotAnswers(answers, vacancy.desirableRequirements, () => ({}));
// Also freezes requiredAnswer - what screeningService reads to decide
// pass/fail.
const snapshotDisqualifying = (answers, vacancy) =>
  snapshotAnswers(answers, vacancy.disqualifyingRequirements, (r) => ({ requiredAnswer: r.requiredAnswer }));

module.exports = { snapshotDesirable, snapshotDisqualifying };
