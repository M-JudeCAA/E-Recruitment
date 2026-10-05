// Position seniority, entered and shown as words but stored as a number
// (Position.level), so "reports to" can stay a plain "higher level within the
// same department" comparison (positionModel.findSeniorInDepartment).
// Mirrored in frontend/src/utils/positionLevels.js.
const POSITION_LEVELS = [
  { value: 1, label: 'Officer' },
  { value: 2, label: 'Senior' },
  { value: 3, label: 'Principal' },
  { value: 4, label: 'Manager' },
  { value: 5, label: 'Director' }
];

const LEVEL_WORDS = POSITION_LEVELS.map((l) => l.label);

// Accepts the word (any case, surrounding spaces ignored) or its number;
// returns the number, or null if it isn't one of the five.
function levelFromInput(input) {
  if (typeof input === 'number' || /^\s*\d+\s*$/.test(String(input ?? ''))) {
    const n = Number(input);
    return POSITION_LEVELS.some((l) => l.value === n) ? n : null;
  }
  const word = String(input ?? '').trim().toLowerCase();
  const match = POSITION_LEVELS.find((l) => l.label.toLowerCase() === word);
  return match ? match.value : null;
}

function levelLabel(value) {
  return POSITION_LEVELS.find((l) => l.value === value)?.label || `Level ${value}`;
}

module.exports = { POSITION_LEVELS, LEVEL_WORDS, levelFromInput, levelLabel };
