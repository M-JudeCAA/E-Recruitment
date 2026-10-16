const { suggestScreening, screensApplicants, backfillFor, levelsIn, yearsIn, fieldIn } = require('../src/utils/screeningSuggestions');

// What a requisition's Essential Requirements suggest screening should check.
describe('suggestScreening', () => {
  test('a degree in a field: the level and the years are checked, the field becomes a question with the certificate as evidence', () => {
    const s = suggestScreening([
      'An honors bachelor’s degree in Computer Science, Information Technology or equivalent',
      'One-year relevant work experience.'
    ]);
    expect(s).toEqual(expect.objectContaining({
      minimumEducationLevel: 'Bachelors',
      minimumExperienceYears: 1,
      preferredFieldOfStudy: 'Computer Science, Information Technology',
      disqualifyingQuestion: {
        id: expect.any(String),
        // Word's curly apostrophe comes out straight.
        text: 'Do you hold an honors bachelor\'s degree in Computer Science, Information Technology or equivalent?',
        requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'Degree certificate or academic transcript'
      }
    }));
    expect(s.sources).toEqual({
      education: 'An honors bachelor\'s degree in Computer Science, Information Technology or equivalent',
      experience: 'One-year relevant work experience.'
    });
  });

  test('a choice of qualifications: the lowest level, and no question that would turn one route away', () => {
    const s = suggestScreening(["A Master's degree in Aviation Management; a Bachelor's degree with 10 years' experience may be considered"]);
    expect(s.minimumEducationLevel).toBe('Bachelors');
    expect(s.preferredFieldOfStudy).toBe('Aviation Management');
    expect(s).not.toHaveProperty('disqualifyingQuestion');
    // The 10 years belong to the bachelor's route only.
    expect(s).not.toHaveProperty('minimumExperienceYears');
  });

  test('several requirements all apply: the highest of them is the minimum', () => {
    const s = suggestScreening(['Bachelor of Laws (LLB) from a recognised university', 'Postgraduate Diploma in Legal Practice', 'Minimum of 5 years post-qualification experience']);
    expect(s.minimumEducationLevel).toBe('Postgraduate');
    expect(s.disqualifyingQuestion.text).toBe('Do you hold a Postgraduate Diploma in Legal Practice?');
    expect(s.minimumExperienceYears).toBe(5);
  });

  test('a level with no field: only the minimum education', () => {
    const s = suggestScreening(['A university degree', 'At least three (3) years of supervisory experience']);
    expect(s).toEqual(expect.objectContaining({ minimumEducationLevel: 'Bachelors', minimumExperienceYears: 3 }));
    expect(s).not.toHaveProperty('disqualifyingQuestion');
    expect(s).not.toHaveProperty('preferredFieldOfStudy');
  });

  test('nothing to suggest', () => {
    expect(suggestScreening(['Excellent communication skills'])).toEqual({ sources: {} });
    expect(suggestScreening(undefined)).toEqual({ sources: {} });
  });
});

describe('reading a requirement', () => {
  test.each([
    ["A Master's degree in Finance", ['Masters']],
    ['PhD in Aeronautics', ['PhD']],
    ['A Diploma in Electrical Engineering', ['Diploma']],
    ['Postgraduate Diploma in Project Planning', ['Postgraduate']],
    ['UACE with two principal passes', ['ALevel']],
    ['A BSc in Statistics', ['Bachelors']],
    ['Good interpersonal skills', []]
  ])('levels in "%s"', (text, levels) => {
    expect(levelsIn(text)).toEqual(levels);
  });

  test.each([
    ['One-year relevant work experience.', 1],
    ['At least three (3) years of relevant working experience', 3],
    ['Minimum of 5 years post-qualification experience', 5],
    ['5 years in a busy office', null],
    ['Six months experience', null]
  ])('years in "%s"', (text, years) => {
    expect(yearsIn(text)).toBe(years);
  });

  test.each([
    ['A degree in Civil Engineering from a recognised institution', 'Civil Engineering'],
    ['Bachelor of Laws (LLB)', 'Laws (LLB)'],
    ['A university degree', null]
  ])('field in "%s"', (text, field) => {
    expect(fieldIn(text)).toBe(field);
  });
});

describe('screensApplicants', () => {
  test('nothing set means nothing is checked', () => {
    expect(screensApplicants({ disqualifyingRequirements: [], requiredExamGrades: [] })).toBe(false);
  });

  test.each([
    { minimumEducationLevel: 'Diploma' }, { minimumExperienceYears: 2 }, { maximumAge: 40 }, { minimumCGPA: 3.0 },
    { requiredExamGrades: [{ level: 'OLevel', subject: 'Maths', minGrade: 'C6' }] },
    { disqualifyingRequirements: [{ text: 'Licence?' }] }
  ])('%j is checked', (vacancy) => {
    expect(screensApplicants(vacancy)).toBe(true);
  });
});

describe('Word wording', () => {
  test('a curly apostrophe and a field in lower case', () => {
    const s = suggestScreening([
      'A Master’s degree in marketing, MBA, or any related field from an approved, recognized, and reputable university or institution.',
      'A Bachelor’s degree in marketing, Business Administration or any related field from a recognized University or institution',
      'At least 10 years’ experience in a vibrant Marketing and Commercial department'
    ]);
    expect(s.minimumEducationLevel).toBe('Masters');
    expect(s.preferredFieldOfStudy).toBe('marketing, MBA');
    expect(s.disqualifyingQuestion.text).toBe('Do you hold a Master\'s degree in marketing, MBA, or any related field from an approved, recognized, and reputable university or institution?');
    expect(s.minimumExperienceYears).toBe(10);
  });

  test('"in a recognised institution" is not a field', () => {
    expect(fieldIn('A degree obtained in a recognised institution')).toBeNull();
  });
});

describe('backfillFor (vacancies created before suggestions)', () => {
  const now = new Date('2026-10-16T09:00:00Z');
  const open = {
    status: 'Open', deadline: new Date('2026-10-23T14:00:00Z'),
    essentialRequirements: ['An honors bachelor’s degree in Computer Science, Information Technology or equivalent', 'One-year relevant work experience.'],
    disqualifyingRequirements: [], desirableRequirements: []
  };

  test('fills what is empty and adds the field question', () => {
    const { changes, notes } = backfillFor(open, now);
    expect(changes).toEqual(expect.objectContaining({
      minimumEducationLevel: 'Bachelors', minimumExperienceYears: 1, preferredFieldOfStudy: 'Computer Science, Information Technology',
      disqualifyingRequirements: [expect.objectContaining({ requiredAnswer: 'Yes', evidenceRequired: true })]
    }));
    expect(notes).toEqual([]);
  });

  test('never overwrites what HR set', () => {
    const { changes, notes } = backfillFor({ ...open, minimumExperienceYears: 10 }, now);
    expect(changes).not.toHaveProperty('minimumExperienceYears');
    expect(notes).toEqual(['kept the minimumExperienceYears already set (10)']);
  });

  test('HR\'s own Qualifying question about the degree becomes Disqualifying, in their words', () => {
    const asked = { id: 'q1', text: 'Do you have a Bachelor\'s degree in IT or its equivalent?', evidenceRequired: true, evidenceLabel: 'A copy of the transcript' };
    const others = [2, 3, 4, 5].map((n) => ({ id: `q${n}`, text: `Do you have experience with tool ${n}?` }));
    const { changes } = backfillFor({ ...open, desirableRequirements: [asked, ...others] }, now);
    expect(changes.disqualifyingRequirements).toEqual([{
      id: 'q1', text: asked.text, requiredAnswer: 'Yes', evidenceRequired: true, evidenceLabel: 'A copy of the transcript'
    }]);
    expect(changes.desirableRequirements).toEqual(others);
  });

  test('no room for another question, or one HR already made Disqualifying: no question added', () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({ id: `q${n}`, text: `Do you have experience with tool ${n}?` }));
    expect(backfillFor({ ...open, desirableRequirements: five }, now).changes).not.toHaveProperty('disqualifyingRequirements');
    const own = backfillFor({ ...open, disqualifyingRequirements: [{ id: 'd', text: 'Licence?', requiredAnswer: 'Yes' }] }, now);
    expect(own.changes).not.toHaveProperty('disqualifyingRequirements');
    expect(own.notes).toContain('it already has a Disqualifying question, so no field question was added');
  });

  test.each([
    [{ status: 'Closed' }, 'not being advertised (Closed)'],
    [{ status: 'Filled' }, 'not being advertised (Filled)'],
    [{ deadline: new Date('2026-10-01T14:00:00Z') }, 'applications have closed'],
    [{ essentialRequirements: ['Good communication skills'] }, 'nothing in its Essential Requirements could be turned into screening']
  ])('skips %j', (override, reason) => {
    expect(backfillFor({ ...open, ...override }, now)).toEqual({ skipped: reason });
  });

  test('a vacancy waiting for approval is filled even past its deadline', () => {
    expect(backfillFor({ ...open, status: 'PendingApproval', deadline: new Date('2026-10-01') }, now).changes).toHaveProperty('minimumEducationLevel');
  });
});
