import { internalSiteUrl, publicSiteUrl } from '../internalPort';

// The link HR shares for an advertised vacancy. Internal vacancies live on
// Internal Careers (internalPort.js), where only UCAA employees can sign in
// - signing in brings them back to the vacancy; External ones on the
// public careers site, where guests can read the advert.
export function jobShareUrl(vacancy) {
  if (vacancy.postingType === 'Internal') return `${internalSiteUrl()}/careers/vacancies/${vacancy.id}`;
  return `${publicSiteUrl()}/jobs/${vacancy.id}`;
}

// Only a published vacancy still taking applications is worth sharing -
// candidates can't open one that is pending, closed or past its deadline.
export function canShareJob(vacancy, now = new Date()) {
  if (!['Open', 'PartiallyFilled'].includes(vacancy.status)) return false;
  return !vacancy.deadline || new Date(vacancy.deadline) >= now;
}

// navigator.clipboard needs a secure context (HTTPS or localhost); the
// textarea copy covers the office address over plain HTTP.
export async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  if (!ok) throw new Error('Copy failed');
}
