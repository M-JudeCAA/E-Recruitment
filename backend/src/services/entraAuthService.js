const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Staff sign-in with a UCAA Microsoft (Entra ID) account. The browser signs in
// through MSAL (Auth Code + PKCE) and posts us the ID token it got back;
// this checks that token and returns who it names. It proves identity
// only - what that person may do here is decided by our own StaffUser
// row, never by anything in Entra.
//
// One app registration, ENTRA_STAFF_CLIENT_ID (the staff port), which can
// be restricted to an Entra group ("Assignment required"). Candidates,
// internal ones included, sign in with email and password.

const APPS = {
  staff: () => process.env.ENTRA_STAFF_CLIENT_ID
};

// An ID token is only ever exchanged right after the sign-in that minted
// it; an older one is refused even while Entra would still call it valid.
const MAX_TOKEN_AGE = '10m';

class EntraAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

const clients = new Map();
function keysFor(tenantId) {
  if (!clients.has(tenantId)) {
    clients.set(tenantId, jwksClient({
      jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxAge: 12 * 60 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10
    }));
  }
  return clients.get(tenantId);
}

function isConfigured(app) {
  return Boolean(process.env.ENTRA_TENANT_ID && APPS[app] && APPS[app]());
}

function internalDomains() {
  return (process.env.INTERNAL_EMAIL_DOMAIN || '')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

function verifySignature(idToken, tenantId, audience) {
  const client = keysFor(tenantId);
  const getKey = (header, callback) => {
    client.getSigningKey(header.kid)
      .then((key) => callback(null, key.getPublicKey()))
      .catch((err) => callback(err));
  };
  return new Promise((resolve, reject) => {
    jwt.verify(idToken, getKey, {
      algorithms: ['RS256'],
      audience,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      maxAge: MAX_TOKEN_AGE
    }, (err, claims) => (err ? reject(err) : resolve(claims)));
  });
}

// Returns { oid, email, name } for a valid ID token from our tenant, issued
// to the given app, for a member (not a B2B guest) whose address is on the
// internal domain. Throws EntraAuthError otherwise.
async function verifyIdToken(idToken, app) {
  if (!isConfigured(app)) {
    throw new EntraAuthError('Microsoft sign-in is not set up on this server yet.', 501);
  }
  if (typeof idToken !== 'string' || !idToken) {
    throw new EntraAuthError('idToken is required', 400);
  }
  const tenantId = process.env.ENTRA_TENANT_ID;

  let claims;
  try {
    claims = await verifySignature(idToken, tenantId, APPS[app]());
  } catch (err) {
    console.warn(`Entra ID token refused (${app}): ${err.message}`);
    throw new EntraAuthError('Your Microsoft sign-in could not be verified. Please try again.');
  }

  if (claims.tid !== tenantId || !claims.oid) {
    throw new EntraAuthError('Your Microsoft sign-in could not be verified. Please try again.');
  }
  // A guest invited into our tenant gets a token from it too - `acct` is 1
  // for a guest when the claim is configured, and the email-domain check
  // below catches a guest either way.
  if (String(claims.acct) === '1') {
    throw new EntraAuthError('Guest accounts cannot sign in here. Use your UCAA account.', 403);
  }
  const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
  const domain = email.split('@')[1];
  if (!email || !internalDomains().includes(domain)) {
    throw new EntraAuthError('Only UCAA accounts can sign in here.', 403);
  }

  return { oid: claims.oid, email, name: claims.name || email };
}

module.exports = { verifyIdToken, isConfigured, internalDomains, EntraAuthError, MAX_TOKEN_AGE };
