// Where a candidate saw the advert (Source of Hire), asked on the Submit
// step. Mirrors backend/src/utils/applicationSources.js. A link carrying
// ?source=<key> (e.g. ?source=LinkedIn on the LinkedIn post) picks it.
export const SOURCES = [
  { key: 'UcaaWebsite', label: 'UCAA website' },
  { key: 'HrPulse', label: 'HR Pulse (staff intranet)' },
  { key: 'LinkedIn', label: 'LinkedIn' },
  { key: 'Newspaper', label: 'Newspaper' },
  { key: 'SocialMedia', label: 'Other social media' },
  { key: 'JobBoard', label: 'A job website' },
  { key: 'Referral', label: 'Someone told me about it' },
  { key: 'Other', label: 'Somewhere else' }
];

const STORAGE_KEY = 'advertSource';

// Remembers ?source= from the link the candidate arrived by, for the rest
// of the visit (they may sign in or register before applying).
export function rememberSourceFromUrl(search) {
  try {
    const key = new URLSearchParams(search).get('source');
    if (SOURCES.some((s) => s.key === key)) sessionStorage.setItem(STORAGE_KEY, key);
  } catch (err) { /* storage unavailable - they'll just pick it themselves */ }
}

export function rememberedSource() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}
