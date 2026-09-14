const {
  screenApplication, scoreApplication, evaluateEssentialCriteria,
  highestEducationLevel, matchesFieldOfStudy, computeExperienceYears
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
  const baseApplication = { cvUrl: 'cv.pdf' };

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

    const above = scoreApplication({ desirableResponses: [] },
      { education: [{ qualificationLevel: 'Masters' }], workExperience: [] },
      { ...baseVacancy, minimumEducationLevel: 'Bachelors' });
    expect(above.score).toBe(1);
    expect(above.reasons).toContain('+1 education exceeds minimum (Masters vs Bachelors required)');
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
      .toMatchObject({ met: true, detail: 'Exceeds minimum (has Masters) - +1 to shortlist score' });
  });

  test('experience row detail matches scoreApplication credit, including the cap', () => {
    const min = { ...baseVacancy, minimumExperienceYears: 2 };
    const result = evaluateEssentialCriteria({ education: [], workExperience: [{ startDate: '2000-01-01', endDate: null }] }, min)[0];
    expect(result.met).toBe(true);
    expect(result.detail).toMatch(/capped/);
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
