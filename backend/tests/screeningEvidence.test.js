const evidence = require('../src/utils/screeningEvidence');
const { normalizeDisqualifyingRequirements, normalizeDesirableRequirements } = require('../src/utils/vacancyValidation');

const vacancy = {
  minimumAge: 21, maximumAge: null, minimumFlyingHours: 1500, requiredExamGrades: [{ level: 'OLevel', subject: 'English', minGrade: '6' }],
  minimumExperienceYears: 0, minimumCGPA: null,
  disqualifyingRequirements: [
    { id: 'q1', text: 'Do you hold a valid ATPL?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Your ATPL licence' },
    { id: 'q2', text: 'Will you work shifts?', requiredAnswer: 'Yes' }
  ],
  desirableRequirements: [{ id: 'q3', text: 'Type ratings held', answerType: 'number', minValue: 0, evidenceRequired: true }]
};

test('what screening relies on needs its proof, and a question HR marked only when answered affirmatively', () => {
  expect(evidence.evidenceRequirements(vacancy, {}).map((r) => r.key)).toEqual(['nationalId', 'flyingHours', 'examResults']);
  const keys = evidence.evidenceRequirements(vacancy, { q1: true, q2: true, q3: 2 }).map((r) => r.key);
  expect(keys).toEqual(['nationalId', 'flyingHours', 'examResults', 'question:q1', 'question:q3']);
  expect(evidence.evidenceRequirements(vacancy, { q1: false, q3: 0 }).map((r) => r.key)).not.toContain('question:q1');
  expect(evidence.requirementFor(vacancy, 'question:q1').label).toBe('Your ATPL licence');
  expect(evidence.requirementFor(vacancy, 'question:q3').label).toBe('Evidence for: "Type ratings held"');
  expect(evidence.requirementFor(vacancy, 'question:q2')).toBeNull(); // not marked as needing evidence
  expect(evidence.requirementFor(vacancy, 'experience')).toBeNull(); // no minimum set
});

test('missing evidence is whatever has no Evidence document filed under it', () => {
  const required = evidence.evidenceRequirements(vacancy, { q1: true });
  const docs = [{ category: 'Evidence', evidenceKey: 'nationalId' }, { category: 'Other', evidenceKey: null }, { category: 'Evidence', evidenceKey: 'question:q1' }];
  expect(evidence.missingEvidence(required, docs).map((r) => r.key)).toEqual(['flyingHours', 'examResults']);
});

test('answers come from the snapshotted responses', () => {
  expect(evidence.answersOf({ disqualifyingResponses: [{ id: 'q1', answer: true }], desirableResponses: [{ id: 'q3', answer: 3 }] }))
    .toEqual({ q1: true, q3: 3 });
  expect(evidence.answersOf(null)).toEqual({});
});

test('HR marks a question as needing evidence; the flag survives normalisation', () => {
  expect(normalizeDisqualifyingRequirements([{ id: 'a', text: 'Licensed?', evidenceRequired: true, evidenceLabel: '  Licence copy ' }])[0])
    .toEqual({ id: 'a', text: 'Licensed?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Licence copy' });
  expect(normalizeDesirableRequirements([{ id: 'b', text: 'Certified?', evidenceRequired: false }])[0]).toEqual({ id: 'b', text: 'Certified?' });
});
