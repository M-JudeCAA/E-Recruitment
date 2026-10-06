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

async function graphGet(pathOrUrl, token, headers = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Graph ${res.status}: ${body.error?.code || ''}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Every page of a Graph collection.
async function graphAll(path, token, headers) {
  const out = [];
  for (let next = path; next;) {
    const body = await graphGet(next, token, headers);
    out.push(...(body.value || []));
    next = body['@odata.nextLink'] || null;
  }
  return out;
}

const PERSON_FIELDS = 'id,displayName,mail,userPrincipalName,jobTitle,department,accountEnabled';

// A Graph user as a person HR can give an account to, or null when they
// can't have one: disabled, a guest, or not on the UCAA email domain.
function toPerson(u, domains) {
  const email = String(u.mail || u.userPrincipalName || '').toLowerCase();
  if (!u.displayName || u.accountEnabled === false || String(u.userPrincipalName || '').includes('#EXT#')) return null;
  if (!domains.includes(email.split('@')[1])) return null;
  return { entraObjectId: u.id, name: u.displayName, email, jobTitle: u.jobTitle || null, department: u.department || null };
}

/**
 * The people assigned to the staff app registration (ENTRA_STAFF_CLIENT_ID)
 * in Entra - under the enterprise application's "Users and groups", directly
 * or as direct members of an assigned group. Each with when they were
 * assigned (a group member: when the group was) and how:
 * [{ entraObjectId, name, email, jobTitle, department, assignedAt, via }]
 * where via is null for a direct assignment, else the group's name.
 * Needs the Graph application permissions Application.Read.All (the
 * assignments) and GroupMember.Read.All (group members) besides User.Read.All.
 */
async function staffAppAssignments() {
  const appId = process.env.ENTRA_STAFF_CLIENT_ID;
  if (!appId) throw Object.assign(new Error('ENTRA_STAFF_CLIENT_ID is not set'), { status: 501 });
  const token = await accessToken();
  const domains = internalDomains();
  const app = await graphGet(`/servicePrincipals(appId='${encodeURIComponent(appId)}')?$select=id`, token);
  const assignments = await graphAll(`/servicePrincipals/${app.id}/appRoleAssignedTo?$top=999`, token);

  const people = new Map(); // entraObjectId -> person; the earliest assignment wins
  const add = (person, assignedAt, via) => {
    if (!person) return;
    const seen = people.get(person.entraObjectId);
    if (!seen || new Date(assignedAt) < new Date(seen.assignedAt)) people.set(person.entraObjectId, { ...person, assignedAt, via });
  };

  const userAssignments = assignments.filter((a) => a.principalType === 'User');
  // Users by id, 15 to a request (Graph's limit for an `in` filter).
  for (let i = 0; i < userAssignments.length; i += 15) {
    const chunk = userAssignments.slice(i, i + 15);
    const ids = chunk.map((a) => `'${a.principalId}'`).join(',');
    const users = await graphAll(`/users?$filter=id in (${ids})&$select=${PERSON_FIELDS}`, token);
    for (const u of users) add(toPerson(u, domains), chunk.find((a) => a.principalId === u.id).createdDateTime, null);
  }
  // Direct members only: Entra doesn't pass an app assignment on through a
  // group nested in the assigned one, so its members couldn't sign in.
  for (const group of assignments.filter((a) => a.principalType === 'Group')) {
    const members = await graphAll(`/groups/${group.principalId}/members/microsoft.graph.user?$select=${PERSON_FIELDS}&$top=999`,
      token, { ConsistencyLevel: 'eventual' });
    for (const u of members) add(toPerson(u, domains), group.createdDateTime, group.principalDisplayName || 'a group');
  }
  return [...people.values()].sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));
}

module.exports = { isConfigured, searchPeople, cleanQuery, staffAppAssignments };
