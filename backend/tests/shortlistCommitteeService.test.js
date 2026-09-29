const {
  defaultCriteria, normalizeCriteria, planAssignments, computeResults, shortlistFromResults, MET, PARTLY, NOT_MET
} = require('../src/services/shortlistCommitteeService');

const E1 = { id: 'e1e1e1', kind: 'Essential', label: 'Degree', weight: 1 };
const E2 = { id: 'e2e2e2', kind: 'Essential', label: 'Experience', weight: 1 };
const D1 = { id: 'd1d1d1', kind: 'Desirable', label: 'Masters', weight: 1 };
const CRITERIA = [E1, E2, D1];

// One applicant: each rater is [e1, e2, d1].
function applicant(applicationId, raters, extra = {}) {
  return {
    applicationId,
    experienceYears: extra.experienceYears || 0,
    ratings: raters.map(([e1, e2, d1], i) => ({
      memberSubmitted: extra.unsubmitted?.includes(i) ? false : true,
      conflict: extra.conflicts?.includes(i) || false,
      values: { e1e1e1: e1, e2e2e2: e2, d1d1d1: d1 }
    }))
  };
}

describe('computeResults', () => {
  test('bands follow the committee\'s agreement on essential criteria', () => {
    const rows = computeResults(CRITERIA, [
      applicant(1, [[MET, MET, 4], [MET, MET, 4], [MET, MET, 2]]), // unanimous
      applicant(2, [[MET, MET, 5], [MET, NOT_MET, 5], [MET, MET, 5]]), // majority
      applicant(3, [[MET, MET, 5], [MET, PARTLY, 5], [MET, NOT_MET, 5]]), // E2 has no majority
      applicant(4, [[MET, MET, 5], [NOT_MET, MET, 5], [NOT_MET, MET, 5]]) // majority: E1 not met
    ]);
    const band = Object.fromEntries(rows.map((r) => [r.applicationId, r.band]));
    expect(band).toEqual({ 1: 'Unanimous', 2: 'Majority', 3: 'Disputed', 4: 'NotQualified' });
    // Settled essentials outrank a better desirable score.
    expect(rows.map((r) => r.applicationId)).toEqual([1, 2, 3, 4]);
    expect(rows.find((r) => r.applicationId === 3).disputed).toEqual(['e2e2e2']);
  });

  test('within a band, the weighted consensus score decides, then agreement', () => {
    const rows = computeResults(CRITERIA, [
      applicant(1, [[MET, MET, 3], [MET, MET, 3], [MET, MET, 3]]),
      applicant(2, [[MET, MET, 5], [MET, MET, 4], [MET, MET, 3]]),
      // Same average desirable (4) as #2, but a split committee.
      applicant(3, [[MET, MET, 5], [MET, MET, 5], [MET, MET, 2]])
    ]);
    expect(rows.map((r) => [r.applicationId, r.rank])).toEqual([[2, 1], [3, 2], [1, 3]]);
    expect(rows[0].agreement).toBeGreaterThan(rows[1].agreement);
  });

  test('applicants equal on every measure share a rank', () => {
    const same = [[MET, MET, 4], [MET, MET, 4], [MET, MET, 4]];
    const rows = computeResults(CRITERIA, [applicant(1, same), applicant(2, same), applicant(3, [[MET, MET, 1], [MET, MET, 1], [MET, MET, 1]])]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  test('a chair ruling settles a disputed criterion', () => {
    const rows = computeResults(CRITERIA, [applicant(1, [[MET, MET, 3], [MET, PARTLY, 3], [MET, NOT_MET, 3]])],
      [{ applicationId: 1, criterionId: 'e2e2e2', outcome: 'Met' }]);
    expect(rows[0].band).toBe('Majority');
    expect(rows[0].criteria.find((c) => c.id === 'e2e2e2').decidedByChair).toBe(true);
  });

  test('only submitted, non-conflicted ratings count', () => {
    const rows = computeResults(CRITERIA, [
      applicant(1, [[MET, MET, 3], [MET, MET, 3], [NOT_MET, NOT_MET, 1], [NOT_MET, NOT_MET, 1]], { unsubmitted: [2], conflicts: [3] })
    ]);
    expect(rows[0].raterCount).toBe(2);
    expect(rows[0].band).toBe('Unanimous');
  });

  test('with fewer than two counted raters, every essential goes to the chair', () => {
    const rows = computeResults(CRITERIA, [applicant(1, [[MET, MET, 3], [NOT_MET, NOT_MET, 1]], { conflicts: [1] })]);
    expect(rows[0].band).toBe('Disputed');
    expect(rows[0].disputed).toEqual(['e1e1e1', 'e2e2e2']);
    expect(rows[0].criteria[0].tooFewRaters).toBe(true);
  });

  test('an applicant nobody has rated is disputed, never qualified by default', () => {
    const rows = computeResults(CRITERIA, [applicant(1, [])]);
    expect(rows[0].band).toBe('Disputed');
  });
});

describe('shortlistFromResults', () => {
  const rows = [
    { applicationId: 1, band: 'Unanimous', rank: 1 },
    { applicationId: 2, band: 'Majority', rank: 2 },
    { applicationId: 3, band: 'Majority', rank: 2 },
    { applicationId: 4, band: 'Majority', rank: 4 },
    { applicationId: 5, band: 'NotQualified', rank: 5 }
  ];

  test('takes the top N and everyone tied at the cut line', () => {
    expect(shortlistFromResults(rows, 2, 1)).toEqual([1, 2, 3]);
    expect(shortlistFromResults(rows, 4, 1)).toEqual([1, 2, 3, 4]);
  });

  test('never includes an applicant the committee found not qualified', () => {
    expect(() => shortlistFromResults(rows, 5, 1)).toThrow(/Only 4/);
  });

  test('must cover at least the number of posts', () => {
    expect(() => shortlistFromResults(rows, 2, 3)).toThrow(/at least 3/);
  });
});

describe('planAssignments', () => {
  test('small committees: everyone rates everyone', () => {
    const plan = planAssignments([1, 2], [10, 11, 12], { ratersPerApplicant: 3 });
    expect(plan).toHaveLength(6);
    expect(plan.every((p) => !p.calibration)).toBe(true);
  });

  test('large pools: a shared calibration set, then balanced sub-panels', () => {
    const apps = Array.from({ length: 200 }, (_, i) => i + 1);
    const members = [10, 11, 12, 13, 14, 15];
    const plan = planAssignments(apps, members, { ratersPerApplicant: 3, calibrationCount: 10 });

    for (const id of apps.slice(0, 10)) expect(plan.filter((p) => p.applicationId === id)).toHaveLength(6);
    for (const id of apps.slice(10)) {
      const raters = plan.filter((p) => p.applicationId === id).map((p) => p.memberId);
      expect(new Set(raters).size).toBe(3);
    }
    const loads = members.map((m) => plan.filter((p) => p.memberId === m).length);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    expect(loads[0]).toBe(10 + 95); // 10 calibration + 190*3/6
  });
});

describe('criteria', () => {
  test('the default sheet comes from the vacancy\'s person specification', () => {
    const list = defaultCriteria({
      minimumEducationLevel: 'Bachelors', minimumExperienceYears: 3,
      requiredExamGrades: [{ id: 'g1', level: 'OLevel', subject: 'English', minGrade: 'C6' }],
      essentialRequirements: ['Knowledge of ICAO Annex 17'],
      desirableRequirements: [{ id: 'q1', text: 'Holds a Masters' }],
      specialSkills: ['Strong written English']
    });
    expect(list.map((c) => [c.kind, c.autoKey || c.question || null])).toEqual([
      ['Essential', 'education'], ['Essential', 'experience'], ['Essential', 'examGrade-g1'], ['Essential', null],
      ['Desirable', 'q1'], ['Desirable', null]
    ]);
  });

  test('HR edits are validated and keep existing ids', () => {
    const out = normalizeCriteria([{ id: 'abcdef12', kind: 'Essential', label: 'Degree in aviation', weight: 2, autoKey: 'education' }, { kind: 'Desirable', label: 'Masters' }]);
    expect(out[0]).toEqual({ id: 'abcdef12', kind: 'Essential', label: 'Degree in aviation', weight: 2, autoKey: 'education' });
    expect(out[1].id).toMatch(/^[a-f0-9]{12}$/);
    expect(() => normalizeCriteria([{ kind: 'Desirable', label: 'Masters' }])).toThrow(/Essential/);
    expect(() => normalizeCriteria([{ kind: 'Essential', label: 'Degree', weight: 9 }])).toThrow(/weight/);
  });
});
