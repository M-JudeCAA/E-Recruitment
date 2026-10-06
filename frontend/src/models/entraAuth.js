import { PublicClientApplication, BrowserAuthErrorCodes } from '@azure/msal-browser';

// Sign-in with a UCAA Microsoft (Entra ID) account, in a popup (Auth Code +
// PKCE, handled by MSAL). We only want the ID token back: the API checks it
// and issues our own session (backend/src/services/entraAuthService.js), and
// decides there - not here, and not in Entra - whether the person may sign
// in as staff.
//
// Two app registrations, matching the backend:
//   staff     - VITE_ENTRA_STAFF_CLIENT_ID (staff port; assignment-restricted in Entra)
//   candidate - VITE_ENTRA_CANDIDATE_CLIENT_ID (internal candidates; whole tenant)
// Their redirect URI is /entra-redirect.html on each origin (see public/).

const TENANT_ID = import.meta.env.VITE_ENTRA_TENANT_ID;
const CLIENT_IDS = {
  staff: import.meta.env.VITE_ENTRA_STAFF_CLIENT_ID,
  candidate: import.meta.env.VITE_ENTRA_CANDIDATE_CLIENT_ID,
};

const apps = {};

export function isEntraConfigured(kind) {
  return Boolean(TENANT_ID && CLIENT_IDS[kind]);
}

async function appFor(kind) {
  if (!apps[kind]) {
    const app = new PublicClientApplication({
      auth: {
        clientId: CLIENT_IDS[kind],
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: `${window.location.origin}/entra-redirect.html`,
      },
      // Nothing worth keeping: the ID token is exchanged at once for our own
      // session, and MSAL's cache would only outlive it.
      cache: { cacheLocation: 'sessionStorage' },
    });
    apps[kind] = app.initialize().then(() => app);
  }
  return apps[kind];
}

// Resolves to the ID token, or null if the person closed the popup.
export async function signInWithMicrosoft(kind) {
  if (!isEntraConfigured(kind)) {
    throw new Error('Microsoft sign-in is not set up for this site yet.');
  }
  const app = await appFor(kind);
  try {
    const result = await app.loginPopup({
      scopes: ['openid', 'profile', 'email'],
      // Always ask which account - a shared office PC may have someone
      // else's Microsoft session open.
      prompt: 'select_account',
    });
    return result.idToken;
  } catch (err) {
    if (err?.errorCode === BrowserAuthErrorCodes.userCancelled) return null;
    if (err?.errorCode === BrowserAuthErrorCodes.popupWindowError || err?.errorCode === BrowserAuthErrorCodes.emptyWindowError) {
      throw new Error('Your browser blocked the Microsoft sign-in window. Allow pop-ups for this site and try again.');
    }
    if (err?.errorCode === BrowserAuthErrorCodes.interactionInProgress) {
      throw new Error('A Microsoft sign-in is already open in another window.');
    }
    throw new Error(err?.errorMessage || err?.message || 'Microsoft sign-in failed.');
  }
}

// Drop MSAL's own copy of the account on sign-out (it lives in this tab's
// sessionStorage only; the Microsoft session itself is left alone, as other
// UCAA apps may be using it).
export async function clearMicrosoftSession(kind) {
  if (!apps[kind]) return;
  try {
    const app = await apps[kind];
    await app.clearCache();
  } catch {
    // nothing to clear
  }
}

// Searching the UCAA staff directory with the signed-in staff member's own
// Graph permission (delegated, granted to the staff app registration) - for
// picking a vacancy's hiring manager. Tries User.Read.All (job title,
// department, enabled accounts only), then User.ReadBasic.All. Resolves to
// [{ entraObjectId, name, email, jobTitle, department }]; throws if Graph
// can't be used here (not set up, consent missing, popup blocked).
//
// kind 'candidate': an employee on Internal Careers picking their supervisor,
// with their own session on the candidate app - User.ReadBasic.All only (no
// admin consent needed per user, though an admin can grant it for everyone)
// and silently only: it runs as they type, where a popup would be blocked.
const GRAPH_USERS = 'https://graph.microsoft.com/v1.0/users';

async function graphToken(scope, kind = 'staff') {
  const app = await appFor(kind);
  const account = app.getActiveAccount() || app.getAllAccounts()[0];
  const request = { scopes: [scope], ...(account ? { account } : {}) };
  try {
    if (!account) throw new Error('no account');
    return (await app.acquireTokenSilent(request)).accessToken;
  } catch (err) {
    if (kind !== 'staff') throw err;
    const result = await app.acquireTokenPopup(request);
    app.setActiveAccount(result.account);
    return result.accessToken;
  }
}

export async function searchStaffDirectory(query, kind = 'staff') {
  if (!isEntraConfigured(kind)) throw new Error('Microsoft sign-in is not set up for this site.');
  const q = String(query || '').replace(/["\\]/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return [];
  let lastError;
  const scopes = kind === 'staff' ? [['User.Read.All', true], ['User.ReadBasic.All', false]] : [['User.ReadBasic.All', false]];
  for (const [scope, full] of scopes) {
    try {
      const token = await graphToken(scope, kind);
      const params = new URLSearchParams({
        $search: `"displayName:${q}" OR "mail:${q}"`,
        $select: full ? 'id,displayName,mail,userPrincipalName,jobTitle,department' : 'id,displayName,mail,userPrincipalName',
        $top: '15', $count: 'true',
        ...(full ? { $filter: 'accountEnabled eq true' } : {})
      });
      const res = await fetch(`${GRAPH_USERS}?${params}`, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } });
      if (!res.ok) throw new Error(`Directory search failed (${res.status})`);
      const body = await res.json();
      return (body.value || [])
        // Guests (#EXT#) and accounts without a mailbox can't be a hiring manager.
        .filter((u) => u.displayName && (u.mail || u.userPrincipalName) && !String(u.userPrincipalName || '').includes('#EXT#'))
        .map((u) => ({
          entraObjectId: u.id, name: u.displayName, email: String(u.mail || u.userPrincipalName).toLowerCase(),
          jobTitle: u.jobTitle || null, department: u.department || null
        }))
        .slice(0, 10);
    } catch (err) {
      if (err?.errorCode === BrowserAuthErrorCodes.userCancelled) throw new Error('The Microsoft sign-in was closed.');
      lastError = err;
    }
  }
  throw lastError || new Error('The staff directory could not be searched.');
}

// The signed-in UCAA employee's own directory entry (Graph /me with the
// User.Read permission every app has), for filling in their employment
// details on Internal Careers. Silent only - never opens a window - and
// resolves to {} when Graph can't be reached or holds nothing, so the
// person simply types the details in. Resolves to
// { jobTitle, department, employeeId, managerName, managerEmail }.
export async function myDirectoryProfile() {
  if (!isEntraConfigured('candidate')) return {};
  try {
    const app = await appFor('candidate');
    const account = app.getActiveAccount() || app.getAllAccounts()[0];
    if (!account) return {};
    const { accessToken } = await app.acquireTokenSilent({ scopes: ['User.Read'], account });
    const headers = { Authorization: `Bearer ${accessToken}` };
    const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=jobTitle,department,employeeId', { headers })
      .then((r) => (r.ok ? r.json() : {}));
    const manager = await fetch('https://graph.microsoft.com/v1.0/me/manager?$select=displayName,mail,userPrincipalName', { headers })
      .then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    return {
      jobTitle: me.jobTitle || null,
      department: me.department || null,
      employeeId: me.employeeId || null,
      managerName: manager.displayName || null,
      managerEmail: (manager.mail || manager.userPrincipalName || '').toLowerCase() || null
    };
  } catch {
    return {};
  }
}
