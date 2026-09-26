// Frontend mirror of backend/src/utils/entryDedup.js (necessarily
// duplicated - no shared package between backend/ and frontend/, same as
// validators.js/profileCompleteness.js). Used to stop a CV-suggested
// education/work-experience entry from being staged as a card at all when
// it's equivalent to one already on the profile or already staged -
// otherwise clicking "Review & add" on a re-uploaded CV (or a CV that
// restates a manually-entered credential) would offer the same entry
// again, and adding it would create a duplicate row server-side would
// have to silently no-op.

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function educationKey({ institution, qualificationLevel, fieldOfStudy }) {
  return [normalizeText(institution), normalizeText(qualificationLevel), normalizeText(fieldOfStudy)].join('|');
}

export function workExperienceKey({ employer, jobTitle, startDate }) {
  return [normalizeText(employer), normalizeText(jobTitle), normalizeDate(startDate)].join('|');
}

export function certificateKey({ name, issuingOrganization, issueDate }) {
  return [normalizeText(name), normalizeText(issuingOrganization), normalizeDate(issueDate)].join('|');
}
