// Shared "is this the same education/work-experience entry" comparison,
// used in two places that both need it for the same underlying reason -
// CV autofill (cvHeuristics.js) can extract the same entry twice from one
// document (e.g. overlapping section matches), and a candidate can
// re-submit an equivalent entry more than once (re-uploading the same CV
// in a later session, retrying a request, or a CV suggestion that
// duplicates something already saved manually). Comparing on normalized
// key fields rather than exact strings/ids is what makes both of those
// idempotent - "add education" with equivalent data twice has the same
// end result as once.

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// yearCompleted is intentionally left out of the key everywhere it's used
// on its own - two rows for the same institution/level/field but a typo'd
// or since-corrected year are still the same underlying credential.
function educationKey({ institution, qualificationLevel, fieldOfStudy }) {
  return [normalizeText(institution), normalizeText(qualificationLevel), normalizeText(fieldOfStudy)].join('|');
}

function workExperienceKey({ employer, jobTitle, startDate }) {
  return [normalizeText(employer), normalizeText(jobTitle), normalizeDate(startDate)].join('|');
}

// expiryDate is left out for the same reason endDate/duties are left out
// of workExperienceKey - renewing/correcting an expiry date later is still
// the same certificate, not a new one.
function certificateKey({ name, issuingOrganization, issueDate }) {
  return [normalizeText(name), normalizeText(issuingOrganization), normalizeDate(issueDate)].join('|');
}

// Preserves the first occurrence's order/values - later duplicates are
// dropped rather than merged, since this is used on best-effort CV
// extraction where the first match is no more or less trustworthy than
// a later one.
function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

module.exports = { educationKey, workExperienceKey, certificateKey, dedupeBy };
