// Generates: UCAA/ADV/{INT|EXT}/{MM}/{YYYY}
//
// Uniqueness: the format shown has no running number, so two vacancies of
// the same type opened in the same month would otherwise collide. This
// generator keeps the exact shown format for the first vacancy of a given
// type+month+year, and only appends "-2", "-3", etc. for subsequent ones -
// so the common case matches the image exactly, and collisions are still
// distinguishable rather than silently duplicated.
function typeCodeFor(postingType) {
  // SIMPLIFIED - PostingType.Open no longer exists, so this is now a
  // clean two-value match rather than a fallback covering three values.
  return postingType === 'Internal' ? 'INT' : 'EXT';
}

async function generateJobRef(postingType, date, countExistingWithPrefix) {
  const typeCode = typeCodeFor(postingType);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const base = `UCAA/ADV/${typeCode}/${mm}/${yyyy}`;

  const existingCount = await countExistingWithPrefix(base);
  return existingCount === 0 ? base : `${base}-${existingCount + 1}`;
}

module.exports = { generateJobRef, typeCodeFor };
