import { workOverlaps } from '../../src/utils/workOverlaps';

// Jobs with overlapping dates are pointed out, never refused (UAT-007).
describe('overlapping jobs', () => {
  const today = new Date('2026-11-20T00:00:00Z');
  const job = (key, startDate, endDate = '') => ({ key, startDate, endDate });

  test('jobs one after another do not overlap', () => {
    expect(workOverlaps([job('a', '2010-01-01', '2015-06-30'), job('b', '2015-07-01')], today)).toEqual([]);
  });

  test('a few weeks\' overlap at a change of job is ignored; a month or more is not', () => {
    expect(workOverlaps([job('a', '2010-01-01', '2015-07-20'), job('b', '2015-07-01')], today)).toEqual([]);
    expect(workOverlaps([job('a', '2010-01-01', '2016-01-31'), job('b', '2015-07-01')], today)).toEqual([{ a: 'a', b: 'b', identical: false }]);
  });

  test('a current job runs to today', () => {
    expect(workOverlaps([job('a', '2020-01-01'), job('b', '2024-01-01', '2025-01-01')], today)).toEqual([{ a: 'a', b: 'b', identical: false }]);
  });

  test('identical dates are flagged, however short', () => {
    expect(workOverlaps([job('a', '2020-01-01', '2020-01-10'), job('b', '2020-01-01', '2020-01-10')], today)).toEqual([{ a: 'a', b: 'b', identical: true }]);
  });

  test('entries without a start date, or with an end before the start, are left out', () => {
    expect(workOverlaps([job('a', ''), job('b', '2020-01-01'), job('c', '2021-01-01', '2019-01-01')], today)).toEqual([]);
  });
});
