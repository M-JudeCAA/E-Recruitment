import { evidenceRequirements, missingEvidence, academicDocuments, questionIsAcademic } from '../../src/utils/screeningEvidence';
import { disqualifyingMet, failedDisqualifyingRequirements } from '../../src/utils/screeningQuestions';

// Mirrors of backend rules (utils/screeningEvidence.js,
// screeningService.disqualifyingResponseMet): the wizard must ask for the
// same evidence, and stop the same candidates, as the API will.
describe('evidence a vacancy asks for', () => {
  const keys = (vacancy, answers) => evidenceRequirements(vacancy, answers).map((r) => r.key);

  test('nothing for a vacancy with no screened minimums', () => {
    expect(evidenceRequirements({})).toEqual([]);
    expect(evidenceRequirements(null)).toEqual([]);
  });

  test('each structured minimum has its own document', () => {
    expect(keys({ minimumAge: 21 })).toEqual(['nationalId']);
    expect(keys({ maximumAge: 45 })).toEqual(['nationalId']);
    expect(keys({ minimumFlyingHours: 1500 })).toEqual(['flyingHours']);
    expect(keys({ requiredExamGrades: [{ subject: 'Maths' }] })).toEqual(['examResults']);
    expect(keys({ minimumExperienceYears: 3 })).toEqual(['experience']);
    expect(keys({ minimumCGPA: '3.5' })).toEqual(['transcript']);
  });

  test('a minimum of zero, or an empty list, asks for nothing', () => {
    expect(keys({ minimumFlyingHours: 0, minimumExperienceYears: 0, minimumCGPA: null, requiredExamGrades: [] })).toEqual([]);
  });

  test('every requirement comes with a label and a hint for the candidate', () => {
    const [requirement] = evidenceRequirements({ minimumAge: 18 });
    expect(requirement).toEqual({ key: 'nationalId', label: expect.any(String), hint: expect.any(String), academic: false });
  });

  describe('questions HR marked as needing evidence', () => {
    const vacancy = {
      disqualifyingRequirements: [{ id: 'd1', text: 'Do you hold a valid ATC licence?', evidenceRequired: true, evidenceLabel: 'Copy of your ATC licence' }],
      desirableRequirements: [
        { id: 'q1', text: 'Years of radar experience', answerType: 'number', evidenceRequired: true },
        { id: 'q2', text: 'Are you a member of a professional body?', evidenceRequired: false }
      ]
    };

    test('only once the candidate answers Yes, or with a number above zero', () => {
      expect(keys(vacancy, {})).toEqual([]);
      expect(keys(vacancy, { d1: false, q1: 0 })).toEqual([]);
      expect(keys(vacancy, { d1: true, q1: 4, q2: true })).toEqual(['question:d1', 'question:q1']);
    });

    test('use HR\'s description of the evidence, or the question itself', () => {
      const [licence, radar] = evidenceRequirements(vacancy, { d1: true, q1: 2 });
      expect(licence.label).toBe('Copy of your ATC licence');
      expect(radar.label).toBe('Evidence for: "Years of radar experience"');
    });
  });

  test('what is still missing is whatever has no Evidence document filed under its key', () => {
    const requirements = evidenceRequirements({ minimumAge: 21, minimumExperienceYears: 2 });
    const documents = [
      { category: 'Evidence', evidenceKey: 'nationalId' },
      { category: 'Academic', evidenceKey: 'experience' } // an academic document doesn't count
    ];
    expect(missingEvidence(requirements, documents).map((r) => r.key)).toEqual(['experience']);
    expect(missingEvidence(requirements).map((r) => r.key)).toEqual(['nationalId', 'experience']);
  });

  // Academic evidence is uploaded once, with the academic documents (UAT-031).
  describe('academic evidence', () => {
    const vacancy = {
      minimumCGPA: 3, requiredExamGrades: [{ subject: 'Maths' }], minimumAge: 21,
      disqualifyingRequirements: [
        { id: 'd1', text: 'Degree in IT?', evidenceRequired: true, evidenceLabel: 'Degree certificate or academic transcript' },
        { id: 'd2', text: 'ATC licence?', evidenceRequired: true, evidenceLabel: 'Copy of your ATC licence' },
        { id: 'd3', text: 'Course?', evidenceRequired: true, evidenceLabel: 'Course certificate', evidenceAcademic: true },
        { id: 'd4', text: 'Diploma?', evidenceRequired: true, evidenceLabel: 'Diploma certificate', evidenceAcademic: false }
      ]
    };
    const answers = { d1: true, d2: true, d3: true, d4: true };

    test('the transcript, result slips and academic questions are marked academic', () => {
      const marked = Object.fromEntries(evidenceRequirements(vacancy, answers).map((r) => [r.key, r.academic]));
      expect(marked).toEqual({
        nationalId: false, examResults: true, transcript: true,
        'question:d1': true, 'question:d2': false, 'question:d3': true, 'question:d4': false
      });
      expect(questionIsAcademic({ evidenceLabel: 'UCE result slip or certificate' })).toBe(true);
      expect(questionIsAcademic({ evidenceLabel: 'Certificate of service' })).toBe(false);
    });

    test('is never missing - the academic documents cover it', () => {
      expect(missingEvidence(evidenceRequirements(vacancy, answers), []).map((r) => r.key)).toEqual(['nationalId', 'question:d2', 'question:d4']);
    });

    test('academic documents include academic evidence uploaded separately before', () => {
      const docs = [{ id: 1, category: 'Academic' }, { id: 2, category: 'Evidence', evidenceKey: 'transcript' }, { id: 3, category: 'Evidence', evidenceKey: 'nationalId' }];
      expect(academicDocuments(evidenceRequirements(vacancy, answers), docs).map((d) => d.id)).toEqual([1, 2]);
    });
  });
});

describe('disqualifying questions', () => {
  test('are undecided until answered', () => {
    expect(disqualifyingMet({ requiredAnswer: 'Yes' }, undefined)).toBeNull();
  });

  test('a Yes/No question is met by the required answer (Yes unless it says No)', () => {
    expect(disqualifyingMet({ requiredAnswer: 'Yes' }, true)).toBe(true);
    expect(disqualifyingMet({ requiredAnswer: 'Yes' }, false)).toBe(false);
    expect(disqualifyingMet({ requiredAnswer: 'No' }, false)).toBe(true);
    expect(disqualifyingMet({ requiredAnswer: 'No' }, true)).toBe(false);
    expect(disqualifyingMet({}, true)).toBe(true);
  });

  test('a number question is met at or above its minimum', () => {
    const req = { answerType: 'number', minValue: '3' };
    expect(disqualifyingMet(req, 3)).toBe(true);
    expect(disqualifyingMet(req, 2)).toBe(false);
    // A number typed as text is not an answer.
    expect(disqualifyingMet(req, '5')).toBe(false);
  });

  test('the questions an applicant fails - unanswered ones are not failures', () => {
    const requirements = [
      { id: 'a', requiredAnswer: 'Yes' }, { id: 'b', requiredAnswer: 'No' }, { id: 'c', answerType: 'number', minValue: 2 }
    ];
    expect(failedDisqualifyingRequirements(requirements, { a: false, c: 1 }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(failedDisqualifyingRequirements(requirements, { a: true, b: false, c: 2 })).toEqual([]);
    expect(failedDisqualifyingRequirements(null, {})).toEqual([]);
  });
});
