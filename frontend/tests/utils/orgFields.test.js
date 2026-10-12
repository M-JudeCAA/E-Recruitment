import { CODE_MAX, codeAndName, codeError, normalizeCode } from '../../src/utils/orgFields';
import { POSITION_LEVELS, levelLabel } from '../../src/utils/positionLevels';
import { departmentName, directorateName, orgLabel } from '../../src/utils/orgNames';

// The same rules as backend/src/utils/orgFields.js - a form says what is
// wrong before it is sent, and must agree with the API.
describe('organisation codes', () => {
  test('are upper-cased with single spaces', () => {
    expect(normalizeCode('  mgt   acct ')).toBe('MGT ACCT');
    expect(normalizeCode(null)).toBe('');
  });

  test('a code is required', () => {
    expect(codeError('', 'department')).toBe("Give the department's short code");
    expect(codeError('   ', 'position')).toBe("Give the position's short code");
  });

  test.each(['HR', 'dans', 'MGT ACCT', 'R&D', 'ICT/OPS', 'A.T.M.', 'FIN-1', '7'])('accepts %s', (code) => {
    expect(codeError(code, 'department')).toBeNull();
  });

  test.each(['HR!', 'A_B', '-HR', 'HR-', '&', 'Fin#1'])('refuses %s', (code) => {
    expect(codeError(code, 'department')).toBe('Only letters, digits, spaces and & / . -');
  });

  test(`at most ${CODE_MAX} characters`, () => {
    expect(codeError('A'.repeat(CODE_MAX), 'department')).toBeNull();
    expect(codeError('A'.repeat(CODE_MAX + 1), 'department')).toBe(`At most ${CODE_MAX} characters`);
  });

  test('a name is shown with its code unless they are the same', () => {
    expect(codeAndName({ code: 'HR', name: 'Human Resource' })).toBe('Human Resource (HR)');
    expect(codeAndName({ code: 'CWG', name: 'cwg' })).toBe('cwg');
    expect(codeAndName({ code: null, name: 'Finance' })).toBe('Finance');
    expect(codeAndName({ code: 'FIN' })).toBe('FIN');
    expect(codeAndName(null)).toBe('');
  });
});

describe('position levels', () => {
  test('are the five the API stores as 1 to 5', () => {
    expect(POSITION_LEVELS.map((l) => [l.value, l.label])).toEqual([
      [1, 'Officer'], [2, 'Senior'], [3, 'Principal'], [4, 'Manager'], [5, 'Director']
    ]);
  });

  test('are shown as words, whatever type the number arrives as', () => {
    expect(levelLabel(3)).toBe('Principal');
    expect(levelLabel('5')).toBe('Director');
    expect(levelLabel(9)).toBe('Level 9');
  });
});

describe('names shown to candidates', () => {
  test('a short name we know is spelled out; anything else is shown as stored', () => {
    expect(directorateName('dans')).toBe('Air Navigation Services');
    expect(departmentName(' ATM ')).toBe('Air Traffic Management');
    expect(departmentName('Legal Services')).toBe('Legal Services');
    expect(directorateName(undefined)).toBe('');
  });

  test('a department is labelled with its directorate', () => {
    expect(orgLabel({ name: 'ATM', directorate: { name: 'DANS' } }, ' - ')).toBe('Air Traffic Management - Air Navigation Services');
    expect(orgLabel({ name: 'Legal' })).toBe('Legal');
    // The same name at both levels is said once.
    expect(orgLabel({ name: 'FINANCE', directorate: { name: 'Finance' } })).toBe('Finance');
    expect(orgLabel(null)).toBe('');
  });
});
