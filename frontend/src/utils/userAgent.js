// "Chrome on Windows" from a browser's User-Agent string, for the audit log.
// Good enough to tell people's devices apart; the full string is shown too.

const BROWSERS = [
  [/Edg\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari'],
  [/curl\//i, 'curl'], [/PostmanRuntime/i, 'Postman'], [/node|axios/i, 'a script']
];
const SYSTEMS = [
  [/Windows/, 'Windows'], [/Android/, 'Android'], [/iPhone|iPad|iOS/, 'iOS'], [/Mac OS X|Macintosh/, 'macOS'], [/Linux/, 'Linux']
];

export function browserName(ua) {
  if (!ua) return '';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || 'Unknown browser';
}
