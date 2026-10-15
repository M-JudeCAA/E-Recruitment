// Position seniority, entered and shown as words but stored as a number
// (Position.level), so "reports to" can stay a plain "higher level within the
// same department" comparison (positionModel.findSeniorInDepartment). Not
// every directorate uses every level. These are job grades, unrelated to the
// HR roles staff accounts have (ROLE_RANK in middleware/auth.js).
// Mirrored in frontend/src/utils/positionLevels.js.
const POSITION_LEVELS = [
  { value: 1, label: 'Assistant' },
  { value: 2, label: 'Assistant Officer' },
  { value: 3, label: 'Officer' },
  { value: 4, label: 'Senior Officer' },
  { value: 5, label: 'Principal' },
  { value: 6, label: 'Chief' },
  { value: 7, label: 'Manager' },
  { value: 8, label: 'Director' }
];

const LEVEL_WORDS = POSITION_LEVELS.map((l) => l.label);

// Other words for a level - "Senior" is what files from before the eight
// levels call a Senior Officer.
const ALIASES = { senior: 4 };

// Accepts the word (any case, surrounding spaces ignored) or its number;
// returns the number, or null if it isn't one of the levels.
function levelFromInput(input) {
  if (typeof input === 'number' || /^\s*\d+\s*$/.test(String(input ?? ''))) {
    const n = Number(input);
    return POSITION_LEVELS.some((l) => l.value === n) ? n : null;
  }
  const word = String(input ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const match = POSITION_LEVELS.find((l) => l.label.toLowerCase() === word);
  return match ? match.value : (ALIASES[word] ?? null);
}

function levelLabel(value) {
  return POSITION_LEVELS.find((l) => l.value === value)?.label || `Level ${value}`;
}

module.exports = { POSITION_LEVELS, LEVEL_WORDS, levelFromInput, levelLabel };
