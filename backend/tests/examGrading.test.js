const { meetsOLevelGrade, meetsALevelGrade, meetsGrade } = require('../src/utils/examGrading');

describe('meetsOLevelGrade (UCE - lower is better)', () => {
  test('a better (lower) grade than required passes', () => {
    expect(meetsOLevelGrade('2', '6')).toBe(true);
  });
  test('exactly the required grade passes', () => {
    expect(meetsOLevelGrade('6', '6')).toBe(true);
  });
  test('a worse (higher) grade than required fails', () => {
    expect(meetsOLevelGrade('7', '6')).toBe(false);
  });
  test('a fail (9) never passes a real requirement', () => {
    expect(meetsOLevelGrade('9', '9')).toBe(true); // requiring "9 or better" is degenerate but not our call to police
    expect(meetsOLevelGrade('9', '6')).toBe(false);
  });
  test('non-numeric input is treated as not meeting the requirement', () => {
    expect(meetsOLevelGrade('A', '6')).toBe(false);
    expect(meetsOLevelGrade('6', 'A')).toBe(false);
  });
});

describe('meetsALevelGrade (UACE - higher is better)', () => {
  test('a better grade than required passes', () => {
    expect(meetsALevelGrade('A', 'C')).toBe(true);
  });
  test('exactly the required grade passes', () => {
    expect(meetsALevelGrade('C', 'C')).toBe(true);
  });
  test('a worse grade than required fails', () => {
    expect(meetsALevelGrade('D', 'C')).toBe(false);
  });
  test('matches the real UCAA advert wording - "Principal pass (A-C grades)" means D and below fail', () => {
    expect(meetsALevelGrade('C', 'C')).toBe(true);
    expect(meetsALevelGrade('D', 'C')).toBe(false);
    expect(meetsALevelGrade('E', 'C')).toBe(false);
    expect(meetsALevelGrade('O', 'C')).toBe(false);
    expect(meetsALevelGrade('F', 'C')).toBe(false);
  });
  test('unrecognized grade letters are treated as not meeting the requirement', () => {
    expect(meetsALevelGrade('Z', 'C')).toBe(false);
  });
});

describe('meetsGrade', () => {
  test('dispatches to the O-Level comparison for level OLevel', () => {
    expect(meetsGrade('OLevel', '3', '6')).toBe(true);
    expect(meetsGrade('OLevel', '8', '6')).toBe(false);
  });
  test('dispatches to the A-Level comparison for level ALevel', () => {
    expect(meetsGrade('ALevel', 'B', 'C')).toBe(true);
    expect(meetsGrade('ALevel', 'D', 'C')).toBe(false);
  });
});
