// Position seniority, chosen and shown as words; the API stores the number.
// Mirrors backend/src/utils/positionLevels.js.
export const POSITION_LEVELS = [
  { value: 1, label: 'Officer' },
  { value: 2, label: 'Senior' },
  { value: 3, label: 'Principal' },
  { value: 4, label: 'Manager' },
  { value: 5, label: 'Director' }
];

export function levelLabel(value) {
  return POSITION_LEVELS.find((l) => l.value === Number(value))?.label || `Level ${value}`;
}
