// Generates: UCAA/ADV/{INT|EXT}/{MM}/{YYYY}
// - "Open" postings (visible to both internal and external candidates)
// default to EXT, since the image only defines two codes and an openly
// advertised role is, at minimum, externally visible. FLAG: confirm this
// with UCAA - if "Open" should get its own code, this is the one line to change.
//
// Uniqueness: the format shown has no running number, so two vacancies of
// the same type opened in the same month would otherwise collide. This
// generator keeps the exact shown format for the first vacancy of a given
// type+month+year, and only appends "-2", "-3", etc. for subsequent ones -
// so the common case matches the image exactly, and collisions are still
// distinguishable rather than silently duplicated.
function typeCodeFor(postingType) {
  if (postingType === 'Internal') return 'INT';
  return 'EXT'; // External or Open
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
