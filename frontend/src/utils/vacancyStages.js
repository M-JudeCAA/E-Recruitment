import { STATUS_FILL } from '../theme/chartPalette';

// Where a vacancy is, in the words of the Vacancies page's filters - shared
// with the Inbox's "Vacancies by stage" chart so a slice and the filter it
// opens always count the same vacancies. `color` is the stage's chart fill
// (validated as a set in theme/chartPalette.js); `tone` the Pill/card tone.
// Grouped from each vacancy's progress (backend vacancyProgressService).
const live = (v) => ['Open', 'PartiallyFilled'].includes(v.status);

export const VACANCY_STAGES = [
  { key: 'approval', label: 'Pending approval', tone: 'warn', color: STATUS_FILL.waiting, test: (v) => ['PendingApproval', 'Returned'].includes(v.status) },
  { key: 'advertised', label: 'Advertised', tone: 'info', color: STATUS_FILL.info, test: (v) => live(v) && v.progress?.stepIndex === 1 },
  { key: 'selection', label: 'In selection', tone: 'violet', color: STATUS_FILL.violet, test: (v) => live(v) && v.progress?.stepIndex >= 2 && v.progress?.stepIndex <= 5 },
  { key: 'offers', label: 'Offers', tone: 'magenta', color: STATUS_FILL.magenta, test: (v) => live(v) && v.progress?.stepIndex === 6 },
  { key: 'filled', label: 'Filled', tone: 'ok', color: STATUS_FILL.good, test: (v) => v.status === 'Filled' },
  { key: 'closed', label: 'Closed', tone: 'neutral', color: STATUS_FILL.neutral, test: (v) => ['Closed', 'Rejected'].includes(v.status) }
];

/** [{ key, label, color, value }] - how many of `vacancies` are at each stage. */
export function countByStage(vacancies) {
  return VACANCY_STAGES.map((s) => ({ key: s.key, label: s.label, color: s.color, value: vacancies.filter(s.test).length }));
}
