import { SITE } from '../views/careers/careers';

// Where a candidate's notification takes them, on the site they are on
// (public careers or Internal Careers - SITE). Applications, interviews and
// offers are all on My applications; the profile and data notices on My
// profile.
const TO_PROFILE = new Set(['ProfileCompleted', 'DataRequestRefused']);

export function candidateNotificationLink(type) {
  if (TO_PROFILE.has(type)) return SITE.profile;
  return SITE.applications;
}
