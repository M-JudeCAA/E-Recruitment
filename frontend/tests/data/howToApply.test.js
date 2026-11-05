import { describe, it, expect } from 'vitest';
import { howToApply } from '../../src/data/howToApply';

// jsdom's default page is http://localhost:3000 - neither site's own
// address, as on the staff site, so the address comes from the vacancy.
describe('howToApply', () => {
  it('sends an Internal vacancy to Internal Careers with Microsoft sign-in', () => {
    const { siteUrl, steps } = howToApply('Internal');
    expect(siteUrl).toBe('http://localhost:4175');
    expect(steps[0]).toContain('http://localhost:4175');
    expect(steps[0]).toMatch(/UCAA Microsoft account/);
    expect(steps.join(' ')).toMatch(/HR verifies your employment/);
    expect(steps.join(' ')).not.toMatch(/create an account/);
  });

  it('sends an External vacancy to the public careers site to register', () => {
    const { siteUrl, steps } = howToApply('External');
    expect(siteUrl).toBe('http://localhost:5173');
    expect(steps[0]).toContain('http://localhost:5173');
    expect(steps[0]).toMatch(/create an account/);
  });

  it('asks for what submitting needs - referees, academic documents, evidence - and calls the CV optional', () => {
    for (const type of ['Internal', 'External']) {
      const text = howToApply(type).steps.join(' ');
      expect(text).toMatch(/three referees/);
      expect(text).toMatch(/academic documents/);
      expect(text).toMatch(/evidence the vacancy asks for/);
      expect(text).toMatch(/A CV is optional/);
    }
  });
});
