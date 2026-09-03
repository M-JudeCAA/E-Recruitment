const { generateJobRef, typeCodeFor } = require('../src/utils/jobRefGenerator');

describe('typeCodeFor', () => {
  test('maps Internal to INT', () => {
    expect(typeCodeFor('Internal')).toBe('INT');
  });
  test('maps External to EXT', () => {
    expect(typeCodeFor('External')).toBe('EXT');
  });
  test('maps Open to EXT (an openly advertised role is, at minimum, externally visible)', () => {
    expect(typeCodeFor('Open')).toBe('EXT');
  });
});

describe('generateJobRef', () => {
  test('matches the exact UCAA/ADV/{TYPE}/{MM}/{YYYY} format with no collision', async () => {
    const ref = await generateJobRef('External', new Date('2026-09-03'), async () => 0);
    expect(ref).toBe('UCAA/ADV/EXT/09/2026');
  });

  test('zero-pads a single-digit month', async () => {
    const ref = await generateJobRef('External', new Date('2026-01-15'), async () => 0);
    expect(ref).toBe('UCAA/ADV/EXT/01/2026');
  });

  test('uses INT for an Internal posting', async () => {
    const ref = await generateJobRef('Internal', new Date('2026-09-03'), async () => 0);
    expect(ref).toBe('UCAA/ADV/INT/09/2026');
  });

  test('appends -2 on the first same-type, same-month collision', async () => {
    const ref = await generateJobRef('External', new Date('2026-09-03'), async () => 1);
    expect(ref).toBe('UCAA/ADV/EXT/09/2026-2');
  });

  test('appends -3 on a second collision, rather than reusing -2', async () => {
    const ref = await generateJobRef('External', new Date('2026-09-03'), async () => 2);
    expect(ref).toBe('UCAA/ADV/EXT/09/2026-3');
  });

  test('passes the base (unsuffixed) prefix to the collision counter', async () => {
    const counter = jest.fn().mockResolvedValue(0);
    await generateJobRef('Internal', new Date('2026-03-01'), counter);
    expect(counter).toHaveBeenCalledWith('UCAA/ADV/INT/03/2026');
  });
});
