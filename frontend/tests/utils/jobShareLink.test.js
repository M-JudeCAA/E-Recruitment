import { describe, it, expect } from 'vitest';
import { jobShareUrl, canShareJob } from '../../src/utils/jobShareLink';

// jsdom's default page is http://localhost:3000.
describe('jobShareUrl', () => {
  it('sends an Internal vacancy to Internal Careers', () => {
    expect(jobShareUrl({ id: 7, postingType: 'Internal' })).toBe('http://localhost:4175/careers/vacancies/7');
  });

  it('sends an External vacancy to the public careers site', () => {
    expect(jobShareUrl({ id: 7, postingType: 'External' })).toBe('http://localhost:5173/jobs/7');
  });
});

describe('canShareJob', () => {
  const now = new Date('2026-10-15T09:00:00Z');

  it('shares an open vacancy before its deadline', () => {
    expect(canShareJob({ status: 'Open', deadline: '2026-10-20T14:00:00Z' }, now)).toBe(true);
    expect(canShareJob({ status: 'PartiallyFilled', deadline: null }, now)).toBe(true);
  });

  it('does not share one past its deadline or not advertised', () => {
    expect(canShareJob({ status: 'Open', deadline: '2026-10-14T14:00:00Z' }, now)).toBe(false);
    for (const status of ['PendingApproval', 'Returned', 'Rejected', 'Closed', 'Filled']) {
      expect(canShareJob({ status, deadline: '2026-10-20T14:00:00Z' }, now)).toBe(false);
    }
  });
});
