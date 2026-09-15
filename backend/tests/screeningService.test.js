const {
  screenApplication, scoreApplication, evaluateEssentialCriteria,
  highestEducationLevel, matchesFieldOfStudy, computeExperienceYears,
  computeAge, evaluateAge, evaluateFlyingHours, evaluateExamGrades, evaluateCGPA
} = require('../src/services/screeningService');

describe('highestEducationLevel', () => {
  test('ignores rows with an unmapped (null) qualificationLevel', () => {
    expect(highestEducationLevel([
      { qualificationLevel: null },
      { qualificationLevel: 'Bachelors' },
      { qualificationLevel: null }
    ])).toBe('Bachelors');
  });

  test('returns null when every row is unmapped', () => {
    expect(highestEducationLevel([{ qualificationLevel: null }, { qualificationLevel: null }])).toBeNull();
  });

  test('returns null with no rows at all', () => {
    expect(highestEducationLevel([])).toBeNull();
  });
});

describe('matchesFieldOfStudy', () => {
  test('null when the vacancy sets no preference', () => {
    expect(matchesFieldOfStudy([{ fieldOfStudy: 'Aeronautical Engineering' }], null)).toBeNull();
  });

  test('null when the candidate has no fieldOfStudy on file', () => {
    expect(matchesFieldOfStudy([], 'Air Traffic Management')).toBeNull();
    expect(matchesFieldOfStudy([{ fieldOfStudy: null }], 'Air Traffic Management')).toBeNull();
  });

  test('matches case-insensitively as a substring in either direction', () => {
    expect(matchesFieldOfStudy([{ fieldOfStudy: 'air traffic management studies' }], 'Air Traffic Management')).toBe(true);
    expect(matchesFieldOfStudy([{ fieldOfStudy: 'Air Traffic Management' }], 'air traffic management studies')).toBe(true);
  });

  test('false on a genuine mismatch', () => {
    expect(matchesFieldOfStudy([{ fieldOfStudy: 'Accounting' }], 'Air Traffic Management')).toBe(false);
  });
});

describe('screenApplication', () => {
  const baseVacancy = { minimumEducationLevel: null, minimumExperienceYears: null, preferredFieldOfStudy: null };
  const baseApplication = {
    referees: [
      { name: 'A Referee', phone: '0700000001', email: 'a@example.com' },
      { name: 'B Referee', phone: '0700000002', email: 'b@example.com' },
      { name: 'C Referee', phone: '0700000003', email: 'c@example.com' }
    ]
  };

  test('flags unmapped education distinctly from below-minimum', () => {
    const candidate = { education: [{ qualificationLevel: null }], workExperience: [{ startDate: '2020-01-01', endDate: null }] };
    const result = screenApplication(baseApplication, candidate, { ...baseVacancy, minimumEducationLevel: 'Bachelors' });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('Education on file has not been classified by level yet - minimum education requirement could not be verified');
    expect(result.reasons.some((r) => r.startsWith('Below minimum education level'))).toBe(false);
  });

  test('still reports below-minimum when education is mapped but insufficient', () => {
    const candidate = { education: [{ qualificationLevel: 'Diploma' }], workExperience: [{ startDate: '2020-01-01', endDate: null }] };
    const result = screenApplication(baseApplication, candidate, { ...baseVacancy, minimumEducationLevel: 'Bachelors' });
    expect(result.reasons).toContain('Below minimum education level (requires Bachelors, has Diploma)');
  });

  test('passes a candidate who meets a mapped minimum', () => {
    const candidate = { education: [{ qualificationLevel: 'Masters' }], workExperience: [{ startDate: '2020-01-01', endDate: null }] };
    const result = screenApplication(baseApplication, candidate, { ...baseVacancy, minimumEducationLevel: 'Bachelors' });
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test('fieldOfStudyMatch never affects passed/reasons even on a mismatch', () => {
    const candidate = {
      education: [{ qualificationLevel: 'Bachelors', fieldOfStudy: 'Accounting' }],
      workExperience: [{ startDate: '2020-01-01', endDate: null }]
    };
    const result = screenApplication(baseApplication, candidate, {
      ...baseVacancy, minimumEducationLevel: 'Bachelors', preferredFieldOfStudy: 'Air Traffic Management'
    });
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.fieldOfStudyMatch).toBe(false);
  });

  const goodCandidate = {
    education: [{ qualificationLevel: 'Bachelors' }],
    workExperience: [{ startDate: '2020-01-01', endDate: null }]
  };

  test('a disqualifying answer that matches requiredAnswer never fails screening', () => {
    const application = {
      ...baseApplication,
      disqualifyingResponses: [{ id: '1', text: '26 years or younger?', requiredAnswer: 'Yes', answer: true }]
    };
    const result = screenApplication(application, goodCandidate, baseVacancy);
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test('a disqualifying answer that contradicts requiredAnswer fails screening, unlike a desirable "No"', () => {
    const application = {
      ...baseApplication,
      disqualifyingResponses: [{ id: '1', text: '26 years or younger?', requiredAnswer: 'Yes', answer: false }]
    };
    const result = screenApplication(application, goodCandidate, baseVacancy);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('Disqualifying requirement not met: "26 years or younger?"');
  });

  test('requiredAnswer of "No" is honored - answering Yes there is what fails', () => {
    const application = {
      ...baseApplication,
      disqualifyingResponses: [{ id: '1', text: 'Previously terminated for cause?', requiredAnswer: 'No', answer: true }]
    };
    const result = screenApplication(application, goodCandidate, baseVacancy);
    expect(result.passed).toBe(false);

    const okApplication = {
      ...baseApplication,
      disqualifyingResponses: [{ id: '1', text: 'Previously terminated for cause?', requiredAnswer: 'No', answer: false }]
    };
    expect(screenApplication(okApplication, goodCandidate, baseVacancy).passed).toBe(true);
  });

  test('no disqualifyingResponses at all never fails screening', () => {
    const result = screenApplication(baseApplication, goodCandidate, baseVacancy);
    expect(result.passed).toBe(true);
  });

  test('a number-type disqualifying answer at or above minValue passes, below it fails', () => {
    const requirement = { id: '1', text: 'What is your CGPA?', answerType: 'number', minValue: 3 };
    const passing = screenApplication(
      { ...baseApplication, disqualifyingResponses: [{ ...requirement, answer: 3.5 }] }, goodCandidate, baseVacancy
    );
    expect(passing.passed).toBe(true);

    const failing = screenApplication(
      { ...baseApplication, disqualifyingResponses: [{ ...requirement, answer: 2.9 }] }, goodCandidate, baseVacancy
    );
    expect(failing.passed).toBe(false);
    expect(failing.reasons).toContain('Disqualifying requirement not met: "What is your CGPA?"');
  });

  test('below minimum CGPA fails screening, missing CGPA on file is reported distinctly', () => {
    const min = { ...baseVacancy, minimumCGPA: 3 };
    const withLowCGPA = { ...goodCandidate, education: [{ qualificationLevel: 'Bachelors', cgpa: 2.5 }] };
    expect(screenApplication(baseApplication, withLowCGPA, min).reasons).toContain('Below minimum CGPA (requires 3, has 2.5)');

    const withNoCGPA = { ...goodCandidate, education: [{ qualificationLevel: 'Bachelors' }] };
    expect(screenApplication(baseApplication, withNoCGPA, min).reasons)
      .toContain('CGPA not on file - could not verify minimum CGPA requirement');
  });
});

describe('scoreApplication', () => {
  const baseVacancy = { minimumEducationLevel: null, minimumExperienceYears: null, preferredFieldOfStudy: null };

  test('zero score with nothing to credit', () => {
    const candidate = { education: [], workExperience: [] };
    const result = scoreApplication({ desirableResponses: [] }, candidate, baseVacancy);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  test('credits education strictly above the minimum, not merely meeting it', () => {
    const candidate = { education: [{ qualificationLevel: 'Bachelors' }], workExperience: [] };
    const exact = scoreApplication({ desirableResponses: [] }, candidate, { ...baseVacancy, minimumEducationLevel: 'Bachelors' });
    expect(exact.score).toBe(0);

    // Bachelors -> Masters is 2 ranks apart (Postgraduate sits between
    // them in EducationLevel's declared order), not 1 - the credit
    // reflects actual rank distance, not just "any level higher".
    const above = scoreApplication({ desirableResponses: [] },
      { education: [{ qualificationLevel: 'Masters' }], workExperience: [] },
      { ...baseVacancy, minimumEducationLevel: 'Bachelors' });
    expect(above.score).toBe(2);
    expect(above.reasons).toContain('+2 education exceeds minimum (Masters vs Bachelors required)');
  });

  test('caps experience credit so long tenure does not dominate', () => {
    const candidate = {
      education: [],
      workExperience: [{ startDate: '2000-01-01', endDate: null }] // ~26 years
    };
    const result = scoreApplication({ desirableResponses: [] }, candidate, { ...baseVacancy, minimumExperienceYears: 2 });
    expect(result.score).toBe(5); // EXPERIENCE_SCORE_CAP_YEARS
    expect(result.reasons[0]).toMatch(/capped at 5/);
  });

  test('adds 1 point per desirable requirement answered Yes, ignores No', () => {
    const application = {
      desirableResponses: [
        { id: '1', answer: true }, { id: '2', answer: true }, { id: '3', answer: false }
      ]
    };
    const result = scoreApplication(application, { education: [], workExperience: [] }, baseVacancy);
    expect(result.score).toBe(2);
    expect(result.reasons).toContain('+2 met 2 desirable requirement(s)');
  });

  test('credits CGPA strictly above the minimum, capped', () => {
    const candidate = { education: [{ cgpa: 4.9 }], workExperience: [] };
    const result = scoreApplication({ desirableResponses: [] }, candidate, { ...baseVacancy, minimumCGPA: 2 });
    expect(result.score).toBe(2); // CGPA_SCORE_CAP - true diff (2.9) exceeds it
    expect(result.reasons[0]).toMatch(/capped at 2/);
  });

  test('a number-type desirable answer at or above minValue counts as met, below it does not', () => {
    const requirement = { id: '1', answerType: 'number', minValue: 5 };
    const met = scoreApplication(
      { desirableResponses: [{ ...requirement, answer: 5 }] }, { education: [], workExperience: [] }, baseVacancy
    );
    expect(met.score).toBe(1);
    expect(met.reasons).toContain('+1 met 1 desirable requirement(s)');

    const notMet = scoreApplication(
      { desirableResponses: [{ ...requirement, answer: 4 }] }, { education: [], workExperience: [] }, baseVacancy
    );
    expect(notMet.score).toBe(0);
  });

  test('adds 1 point on a field-of-study match, nothing on a miss', () => {
    const candidate = { education: [{ fieldOfStudy: 'Air Traffic Management' }], workExperience: [] };
    const match = scoreApplication({ desirableResponses: [] }, candidate, { ...baseVacancy, preferredFieldOfStudy: 'Air Traffic Management' });
    expect(match.score).toBe(1);

    const miss = scoreApplication({ desirableResponses: [] },
      { education: [{ fieldOfStudy: 'Accounting' }], workExperience: [] },
      { ...baseVacancy, preferredFieldOfStudy: 'Air Traffic Management' });
    expect(miss.score).toBe(0);
  });
});

describe('evaluateEssentialCriteria', () => {
  const baseVacancy = { minimumEducationLevel: null, minimumExperienceYears: null, preferredFieldOfStudy: null };

  test('returns no rows when the vacancy sets no minimums', () => {
    expect(evaluateEssentialCriteria({ education: [], workExperience: [] }, baseVacancy)).toEqual([]);
  });

  test('itemizes each minimum the vacancy sets, independently of the other', () => {
    const candidate = { education: [{ qualificationLevel: 'Masters' }], workExperience: [{ startDate: '2015-01-01', endDate: null }] };
    const results = evaluateEssentialCriteria(candidate, { ...baseVacancy, minimumEducationLevel: 'Bachelors', minimumExperienceYears: 3 });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.key)).toEqual(['education', 'experience']);
    expect(results.every((r) => r.met)).toBe(true);
  });

  test('education row reflects missing/unmapped/below/meets/exceeds distinctly', () => {
    const min = { ...baseVacancy, minimumEducationLevel: 'Bachelors' };

    expect(evaluateEssentialCriteria({ education: [], workExperience: [] }, min)[0]).toMatchObject({ met: false, detail: 'No education record on file' });
    expect(evaluateEssentialCriteria({ education: [{ qualificationLevel: null }], workExperience: [] }, min)[0])
      .toMatchObject({ met: false, detail: 'Education on file has not been classified by level yet' });
    expect(evaluateEssentialCriteria({ education: [{ qualificationLevel: 'Diploma' }], workExperience: [] }, min)[0])
      .toMatchObject({ met: false, detail: 'Below minimum (has Diploma)' });
    expect(evaluateEssentialCriteria({ education: [{ qualificationLevel: 'Bachelors' }], workExperience: [] }, min)[0])
      .toMatchObject({ met: true, detail: 'Meets minimum exactly (Bachelors)' });
    expect(evaluateEssentialCriteria({ education: [{ qualificationLevel: 'Masters' }], workExperience: [] }, min)[0])
      .toMatchObject({ met: true, detail: 'Exceeds minimum (has Masters) - +2 to shortlist score' });
  });

  test('experience row detail matches scoreApplication credit, including the cap', () => {
    const min = { ...baseVacancy, minimumExperienceYears: 2 };
    const result = evaluateEssentialCriteria({ education: [], workExperience: [{ startDate: '2000-01-01', endDate: null }] }, min)[0];
    expect(result.met).toBe(true);
    expect(result.detail).toMatch(/capped/);
  });

  test('cgpa row reflects missing/below/meets/exceeds distinctly', () => {
    const min = { ...baseVacancy, minimumCGPA: 3 };
    expect(evaluateEssentialCriteria({ education: [], workExperience: [] }, min)[0]).toMatchObject({ key: 'cgpa', met: false, detail: 'No CGPA on file' });
    expect(evaluateEssentialCriteria({ education: [{ cgpa: 2.5 }], workExperience: [] }, min)[0]).toMatchObject({ met: false, detail: 'Below minimum (has 2.5)' });
    expect(evaluateEssentialCriteria({ education: [{ cgpa: 3 }], workExperience: [] }, min)[0]).toMatchObject({ met: true, detail: 'Meets minimum exactly (3)' });
    expect(evaluateEssentialCriteria({ education: [{ cgpa: 3.5 }], workExperience: [] }, min)[0]).toMatchObject({ met: true, detail: 'Exceeds minimum (3.5) - +0.5 to shortlist score' });
    expect(evaluateEssentialCriteria({ education: [{ cgpa: 4.9 }], workExperience: [] }, { ...baseVacancy, minimumCGPA: 2 })[0])
      .toMatchObject({ met: true, detail: 'Exceeds minimum (4.9) - +2.0 to shortlist score, capped' });
  });
});

describe('computeAge', () => {
  test('counts a full year only once the birthday has passed', () => {
    expect(computeAge('2000-06-15', new Date('2026-06-14'))).toBe(25);
    expect(computeAge('2000-06-15', new Date('2026-06-15'))).toBe(26);
    expect(computeAge('2000-06-15', new Date('2026-06-16'))).toBe(26);
  });
});

describe('evaluateAge', () => {
  const baseVacancy = { deadline: '2026-09-19T00:00:00.000Z' };

  test('null when the vacancy sets neither bound', () => {
    expect(evaluateAge({ dateOfBirth: '2000-01-01' }, baseVacancy)).toBeNull();
  });

  test('missing when the vacancy sets a bound but the candidate has no date of birth', () => {
    expect(evaluateAge({ dateOfBirth: null }, { ...baseVacancy, maximumAge: 26 }))
      .toMatchObject({ status: 'missing', age: null });
  });

  test('evaluates against the vacancy deadline, not today - matches real UCAA advert wording', () => {
    // Turns 27 on 2026-09-20, the day after this vacancy's deadline - so
    // as of the deadline itself, still 26.
    const candidate = { dateOfBirth: '1999-09-20' };
    expect(evaluateAge(candidate, { ...baseVacancy, maximumAge: 26 })).toMatchObject({ status: 'meets', age: 26 });
  });

  test('below the minimum and above the maximum are reported distinctly', () => {
    expect(evaluateAge({ dateOfBirth: '2010-01-01' }, { ...baseVacancy, minimumAge: 21 })).toMatchObject({ status: 'below' });
    expect(evaluateAge({ dateOfBirth: '1970-01-01' }, { ...baseVacancy, maximumAge: 26 })).toMatchObject({ status: 'above' });
  });
});

describe('evaluateFlyingHours', () => {
  const baseVacancy = { minimumFlyingHours: null };

  test('null when the vacancy sets no minimum', () => {
    expect(evaluateFlyingHours({ flyingHours: 500 }, baseVacancy)).toBeNull();
  });

  test('missing when the vacancy sets a minimum but the candidate has none on file', () => {
    expect(evaluateFlyingHours({ flyingHours: null }, { minimumFlyingHours: 200 }))
      .toMatchObject({ status: 'missing', hours: null });
  });

  test('below/meets/exceeds compare correctly', () => {
    expect(evaluateFlyingHours({ flyingHours: 150 }, { minimumFlyingHours: 200 })).toMatchObject({ status: 'below' });
    expect(evaluateFlyingHours({ flyingHours: 200 }, { minimumFlyingHours: 200 })).toMatchObject({ status: 'meets' });
    expect(evaluateFlyingHours({ flyingHours: 250 }, { minimumFlyingHours: 200 })).toMatchObject({ status: 'exceeds', diff: 50 });
  });
});

describe('evaluateCGPA', () => {
  test('null when the vacancy sets no minimum', () => {
    expect(evaluateCGPA([{ cgpa: 4.5 }], null)).toBeNull();
  });

  test('missing when the vacancy sets a minimum but no education row has a cgpa on file', () => {
    expect(evaluateCGPA([{ cgpa: null }, {}], 3)).toMatchObject({ status: 'missing', cgpa: null });
    expect(evaluateCGPA([], 3)).toMatchObject({ status: 'missing', cgpa: null });
  });

  test('below/meets/exceeds compare correctly', () => {
    expect(evaluateCGPA([{ cgpa: 2.5 }], 3)).toMatchObject({ status: 'below' });
    expect(evaluateCGPA([{ cgpa: 3 }], 3)).toMatchObject({ status: 'meets' });
    expect(evaluateCGPA([{ cgpa: 4.5 }], 3)).toMatchObject({ status: 'exceeds', cgpa: 4.5, diff: 1.5 });
  });

  test('takes the best cgpa across multiple education rows, not just the first', () => {
    expect(evaluateCGPA([{ cgpa: 2.1 }, { cgpa: 4.8 }, { cgpa: 3.3 }], 3)).toMatchObject({ status: 'exceeds', cgpa: 4.8 });
  });
});

describe('evaluateExamGrades', () => {
  test('empty array when the vacancy requires none', () => {
    expect(evaluateExamGrades([], null)).toEqual([]);
  });

  test('missing when the candidate has no grade on file for that subject/level', () => {
    const result = evaluateExamGrades([], [{ id: '1', level: 'OLevel', subject: 'Mathematics', minGrade: '6' }]);
    expect(result[0]).toMatchObject({ status: 'missing', candidateGrade: null });
  });

  test('meets when a passing grade is on file, below when not', () => {
    const grades = [{ level: 'OLevel', subject: 'Mathematics', grade: '3' }];
    expect(evaluateExamGrades(grades, [{ id: '1', level: 'OLevel', subject: 'Mathematics', minGrade: '6' }])[0])
      .toMatchObject({ status: 'meets', candidateGrade: '3' });
    expect(evaluateExamGrades(grades, [{ id: '1', level: 'OLevel', subject: 'Mathematics', minGrade: '2' }])[0])
      .toMatchObject({ status: 'below', candidateGrade: '3' });
  });

  test('subject matching is case-insensitive and level-scoped', () => {
    const grades = [{ level: 'ALevel', subject: 'physics', grade: 'B' }];
    expect(evaluateExamGrades(grades, [{ id: '1', level: 'ALevel', subject: 'Physics', minGrade: 'C' }])[0])
      .toMatchObject({ status: 'meets' });
    // Same subject name but wrong level - an O-Level requirement must not
    // match an A-Level row.
    expect(evaluateExamGrades(grades, [{ id: '1', level: 'OLevel', subject: 'Physics', minGrade: '6' }])[0])
      .toMatchObject({ status: 'missing' });
  });

  test('a retake picks the best grade on file, not just the first row', () => {
    const grades = [
      { level: 'OLevel', subject: 'English', grade: '8' },
      { level: 'OLevel', subject: 'English', grade: '3' }
    ];
    expect(evaluateExamGrades(grades, [{ id: '1', level: 'OLevel', subject: 'English', minGrade: '6' }])[0])
      .toMatchObject({ status: 'meets', candidateGrade: '3' });
  });

  test('when no retake passes, reports the best grade actually achieved, not the first', () => {
    const grades = [
      { level: 'ALevel', subject: 'Chemistry', grade: 'F' },
      { level: 'ALevel', subject: 'Chemistry', grade: 'D' }
    ];
    expect(evaluateExamGrades(grades, [{ id: '1', level: 'ALevel', subject: 'Chemistry', minGrade: 'C' }])[0])
      .toMatchObject({ status: 'below', candidateGrade: 'D' });
  });
});

describe('computeExperienceYears', () => {
  test('does not double-count overlapping concurrent jobs', () => {
    const years = computeExperienceYears([
      { startDate: '2020-01-01', endDate: '2022-01-01' },
      { startDate: '2021-01-01', endDate: '2021-06-01' }
    ]);
    expect(years).toBeCloseTo(2, 1);
  });
});
