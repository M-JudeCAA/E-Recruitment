// Where a candidate saw the advert (Source of Hire, FR-ATS-070), asked on
// the Submit step and stored on Application.source. Mirrored in
// frontend/src/utils/applicationSources.js. A link can carry ?source=<key>
// (e.g. the LinkedIn post links with ?source=LinkedIn) to pick it.

const SOURCES = [
  { key: 'UcaaWebsite', label: 'UCAA website' },
  { key: 'HrPulse', label: 'HR Pulse (staff intranet)' },
  { key: 'LinkedIn', label: 'LinkedIn' },
  { key: 'Newspaper', label: 'Newspaper' },
  { key: 'SocialMedia', label: 'Other social media' },
  { key: 'JobBoard', label: 'A job website' },
  { key: 'Referral', label: 'Someone told me about it' },
  { key: 'Other', label: 'Somewhere else' }
];
const KEYS = new Set(SOURCES.map((s) => s.key));

const labelOf = (key) => SOURCES.find((s) => s.key === key)?.label || 'Not stated';

/** { source, sourceDetail } from a request body - unknown values dropped. */
function parseSource(body) {
  const source = KEYS.has(body?.source) ? body.source : null;
  const detail = typeof body?.sourceDetail === 'string' ? body.sourceDetail.trim().slice(0, 200) : '';
  return { source, sourceDetail: source && detail ? detail : null };
}

module.exports = { SOURCES, labelOf, parseSource };
