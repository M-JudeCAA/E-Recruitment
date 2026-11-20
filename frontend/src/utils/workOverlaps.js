// Jobs whose dates overlap (UAT-007). Holding two jobs at once is legitimate,
// so this only warns and asks the candidate to confirm - it never refuses -
// and screening counts the overlapping time once (backend screeningService
// computeExperienceYears merges the periods). A few weeks' overlap at a
// change of job is normal, so only an overlap of a month or more counts -
// or two jobs with exactly the same dates, which is usually a mistake.

const DAY = 24 * 60 * 60 * 1000;
export const MIN_OVERLAP_DAYS = 31;

const toDate = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : null);

/**
 * entries: [{ key, startDate, endDate }] (dates YYYY-MM-DD, endDate empty = now).
 * Returns [{ a, b, identical }] - the keys of each overlapping pair.
 */
export function workOverlaps(entries, today = new Date()) {
  const ranges = entries
    .map((e) => ({ key: e.key, start: toDate(e.startDate), end: toDate(e.endDate) || today, identical: `${e.startDate}|${e.endDate || ''}` }))
    .filter((r) => r.start && !Number.isNaN(r.start.getTime()) && r.end >= r.start);
  const out = [];
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const a = ranges[i];
      const b = ranges[j];
      const identical = a.identical === b.identical;
      const days = (Math.min(a.end, b.end) - Math.max(a.start, b.start)) / DAY;
      if (identical || days >= MIN_OVERLAP_DAYS) out.push({ a: a.key, b: b.key, identical });
    }
  }
  return out;
}
