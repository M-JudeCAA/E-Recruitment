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

test('missing evidence is whatever has no Evidence document filed under it - academic evidence aside', () => {
  const required = evidence.evidenceRequirements(vacancy, { q1: true });
  const docs = [{ category: 'Evidence', evidenceKey: 'nationalId' }, { category: 'Other', evidenceKey: null }, { category: 'Evidence', evidenceKey: 'question:q1' }];
  // The result slips (examResults) are academic: the Academic documents cover them.
  expect(evidence.missingEvidence(required, docs).map((r) => r.key)).toEqual(['flyingHours']);
});

describe('academic evidence is covered by the Academic documents (UAT-031)', () => {
  const degree = {
    minimumCGPA: 3, requiredExamGrades: [{ level: 'ALevel', subject: 'Maths', minGrade: 'C' }],
    disqualifyingRequirements: [
      { id: 'd1', text: 'Do you hold a degree in IT?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Degree certificate or academic transcript' },
      { id: 'd2', text: 'Licensed?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Licence copy' },
      { id: 'd3', text: 'Short course?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Course certificate', evidenceAcademic: true },
      { id: 'd4', text: 'Diploma in X?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Diploma certificate', evidenceAcademic: false }
    ]
  };
  const answers = { d1: true, d2: true, d3: true, d4: true };

  test('transcript, result slips and academic questions are marked academic - by HR\'s choice, else by the label', () => {
    const marked = Object.fromEntries(evidence.evidenceRequirements(degree, answers).map((r) => [r.key, r.academic]));
    expect(marked).toEqual({ examResults: true, transcript: true, 'question:d1': true, 'question:d2': false, 'question:d3': true, 'question:d4': false });
    expect(evidence.requirementFor(degree, 'transcript').academic).toBe(true);
  });

  test('only the non-academic evidence can be missing', () => {
    const missing = evidence.missingEvidence(evidence.evidenceRequirements(degree, answers), []).map((r) => r.key);
    expect(missing).toEqual(['question:d2', 'question:d4']);
  });

  test('academic documents include academic evidence uploaded separately on older drafts', () => {
    const docs = [
      { id: 1, category: 'Academic' }, { id: 2, category: 'Evidence', evidenceKey: 'transcript' },
      { id: 3, category: 'Evidence', evidenceKey: 'question:d2' }, { id: 4, category: 'Other' }
    ];
    expect(evidence.academicDocuments(degree, docs).map((d) => d.id)).toEqual([1, 2]);
    expect(evidence.academicDocuments({}, [{ id: 5, category: 'Evidence', evidenceKey: 'transcript' }])).toEqual([]);
  });

  test('HR\'s academic choice survives normalisation', () => {
    expect(normalizeDisqualifyingRequirements([{ id: 'a', text: 'Degree?', evidenceRequired: true, evidenceLabel: 'Cert', evidenceAcademic: true }])[0])
      .toEqual({ id: 'a', text: 'Degree?', requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Cert', evidenceAcademic: true });
  });
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
