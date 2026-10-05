import { PublicClientApplication, BrowserAuthErrorCodes } from '@azure/msal-browser';

// Staff sign-in with a UCAA Microsoft (Entra ID) account, in a popup (Auth Code +
// PKCE, handled by MSAL). We only want the ID token back: the API checks it
// and issues our own session (backend/src/services/entraAuthService.js), and
// decides there - not here, and not in Entra - whether the person may sign
// in as staff.
//
// One app registration, VITE_ENTRA_STAFF_CLIENT_ID (staff port; can be
// assignment-restricted in Entra). Candidates sign in with email and
// password. Its redirect URI is /entra-redirect.html on the staff origin
// (see public/).

const TENANT_ID = import.meta.env.VITE_ENTRA_TENANT_ID;
const CLIENT_IDS = {
  staff: import.meta.env.VITE_ENTRA_STAFF_CLIENT_ID,
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
