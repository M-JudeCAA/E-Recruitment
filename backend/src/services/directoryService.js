// Searching UCAA's staff directory (Microsoft Entra ID, through Microsoft
// Graph) - for picking a vacancy's hiring manager. Uses the app's own
// identity (client credentials): ENTRA_TENANT_ID, ENTRA_DIRECTORY_CLIENT_ID
// (defaults to ENTRA_STAFF_CLIENT_ID) and ENTRA_DIRECTORY_CLIENT_SECRET,
// with the Graph application permission User.Read.All granted by an Entra
// administrator. Without them, isConfigured() is false and HR types the
// name and UCAA email instead. Read-only; nothing is stored but the person
// HR picks.

const { internalDomains } = require('./entraAuthService');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_RESULTS = 10;

function settings() {
  return {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_DIRECTORY_CLIENT_ID || process.env.ENTRA_STAFF_CLIENT_ID,
    clientSecret: process.env.ENTRA_DIRECTORY_CLIENT_SECRET
  };
}

function isConfigured() {
  const s = settings();
  return Boolean(s.tenantId && s.clientId && s.clientSecret);
}

let cached = null; // { token, expiresAt }

async function accessToken() {
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const s = settings();
  const res = await fetch(`https://login.microsoftonline.com/${s.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: s.clientId, client_secret: s.clientSecret, grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default'
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Directory sign-in failed (${res.status}): ${body.error || 'no token'}`);
  cached = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return cached.token;
}

// Graph $search needs quotes around each clause; a quote in the query would
// break out of them.
function cleanQuery(q) {
  return String(q || '').replace(/["\\]/g, ' ').trim().slice(0, 60);
}

/**
 * People whose name or email matches `q` (at least 2 characters), enabled
 * accounts on the UCAA email domain only. [{ entraObjectId, name, email, jobTitle, department }]
 */
async function searchPeople(q) {
  const query = cleanQuery(q);
  if (query.length < 2) return [];
  const token = await accessToken();
  const params = new URLSearchParams({
    $search: `"displayName:${query}" OR "mail:${query}"`,
    $filter: 'accountEnabled eq true',
    $select: 'id,displayName,mail,userPrincipalName,jobTitle,department',
    $top: String(MAX_RESULTS * 2),
    $count: 'true'
  });
  const res = await fetch(`${GRAPH}/users?${params}`, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Directory search failed (${res.status}): ${body.error?.code || ''}`);
  const domains = internalDomains();
  return (body.value || [])
    .map((u) => ({
      entraObjectId: u.id, name: u.displayName, email: String(u.mail || u.userPrincipalName || '').toLowerCase(),
      jobTitle: u.jobTitle || null, department: u.department || null
    }))
    .filter((p) => p.name && domains.includes(p.email.split('@')[1]))
    .slice(0, MAX_RESULTS);
}

module.exports = { isConfigured, searchPeople, cleanQuery };
