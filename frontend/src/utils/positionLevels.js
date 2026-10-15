// Position seniority, chosen and shown as words; the API stores the number.
// Job grades, unrelated to staff accounts' HR roles. Not every directorate
// uses every level. Mirrors backend/src/utils/positionLevels.js.
export const POSITION_LEVELS = [
  { value: 1, label: 'Assistant' },
  { value: 2, label: 'Assistant Officer' },
  { value: 3, label: 'Officer' },
  { value: 4, label: 'Senior Officer' },
  { value: 5, label: 'Principal' },
  { value: 6, label: 'Chief' },
  { value: 7, label: 'Manager' },
  { value: 8, label: 'Director' }
];

export function levelLabel(value) {
  return POSITION_LEVELS.find((l) => l.value === Number(value))?.label || `Level ${value}`;
}
