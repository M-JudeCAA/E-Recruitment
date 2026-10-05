// Frontend mirror of backend screeningService.disqualifyingResponseMet, read
// against the vacancy's own requirement rather than a stored snapshot: null
// while unanswered, otherwise whether the answer meets the requirement. A
// wrong answer to a Disqualifying question makes the candidate ineligible -
// the wizard stops them there, and the backend refuses the submit anyway.
export function disqualifyingMet(req, answer) {
  if (answer === undefined) return null;
  if (req.answerType === 'number') return typeof answer === 'number' && answer >= Number(req.minValue);
  return answer === (req.requiredAnswer !== 'No');
}

// The Disqualifying questions this set of answers fails.
export function failedDisqualifyingRequirements(requirements, answers) {
  return (requirements || []).filter((req) => disqualifyingMet(req, answers[req.id]) === false);
}
