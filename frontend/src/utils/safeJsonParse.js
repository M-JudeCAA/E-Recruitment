// Every screening/scoring detail field (screeningReasons, shortlistScoreReasons,
// essentialCriteriaResults, ...) is stored as a JSON string and parsed at
// render time. A bare JSON.parse throws on malformed input (e.g. a partial
// write from a crashed prior request) and, unguarded, takes down the whole
// application list with it - one bad row shouldn't blank the entire page.
export function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
