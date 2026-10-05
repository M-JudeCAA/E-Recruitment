const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// A signing key of our own stands in for Microsoft's published keys.
const { publicKey: mockPublicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
jest.mock('jwks-rsa', () => () => ({
  getSigningKey: (kid) => (kid === 'test-kid'
    ? Promise.resolve({ getPublicKey: () => mockPublicKey.export({ type: 'spki', format: 'pem' }) })
    : Promise.reject(new Error('unknown kid')))
}));

const { verifyIdToken, EntraAuthError } = require('../src/services/entraAuthService');

const TENANT = '11111111-2222-3333-4444-555555555555';
const STAFF_APP = 'staff-client-id';
const CANDIDATE_APP = 'candidate-client-id';

function idToken(claims = {}, options = {}) {
  return jwt.sign(
    { tid: TENANT, oid: 'oid-123', name: 'Jane Okello', preferred_username: 'Jane.Okello@caa.co.ug', ...claims },
    privateKey,
    {
      algorithm: 'RS256', keyid: 'test-kid', expiresIn: '1h',
      audience: STAFF_APP, issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      ...options
    }
  );
}

async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the token to be refused');
}

beforeEach(() => {
  process.env.ENTRA_TENANT_ID = TENANT;
  process.env.ENTRA_STAFF_CLIENT_ID = STAFF_APP;
  process.env.ENTRA_CANDIDATE_CLIENT_ID = CANDIDATE_APP;
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('returns who a valid token names, email lower-cased', async () => {
  await expect(verifyIdToken(idToken(), 'staff')).resolves.toEqual({
    oid: 'oid-123', email: 'jane.okello@caa.co.ug', name: 'Jane Okello'
  });
});

test('prefers the email claim over the sign-in name', async () => {
  const identity = await verifyIdToken(idToken({ email: 'j.okello@caa.co.ug' }), 'staff');
  expect(identity.email).toBe('j.okello@caa.co.ug');
});

test('a token issued to the candidate app is refused by the staff app, and the other way round', async () => {
  expect(await refusal(verifyIdToken(idToken({}, { audience: CANDIDATE_APP }), 'staff'))).toBeInstanceOf(EntraAuthError);
  expect(await refusal(verifyIdToken(idToken(), 'candidate'))).toBeInstanceOf(EntraAuthError);
  await expect(verifyIdToken(idToken({}, { audience: CANDIDATE_APP }), 'candidate')).resolves.toMatchObject({ oid: 'oid-123' });
});

test('a token from another tenant is refused', async () => {
  const other = '99999999-2222-3333-4444-555555555555';
  const err = await refusal(verifyIdToken(idToken({ tid: other }, { issuer: `https://login.microsoftonline.com/${other}/v2.0` }), 'staff'));
  expect(err.status).toBe(401);
});

test('a token not signed with a Microsoft key is refused', async () => {
  const { privateKey: forged } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = jwt.sign({ tid: TENANT, oid: 'x', preferred_username: 'a@caa.co.ug' }, forged, {
    algorithm: 'RS256', keyid: 'test-kid', audience: STAFF_APP, issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`
  });
  expect((await refusal(verifyIdToken(token, 'staff'))).status).toBe(401);
});

test('a token older than ten minutes is refused even though Entra would still accept it', async () => {
  const issuedAt = Math.floor(Date.now() / 1000) - 20 * 60;
  const err = await refusal(verifyIdToken(idToken({ iat: issuedAt }), 'staff'));
  expect(err.status).toBe(401);
});

test('a B2B guest in our tenant is refused', async () => {
  const err = await refusal(verifyIdToken(idToken({ acct: 1 }), 'staff'));
  expect(err.status).toBe(403);
});

test('an account outside the UCAA email domain is refused', async () => {
  const err = await refusal(verifyIdToken(idToken({ preferred_username: 'someone@gmail.com' }), 'staff'));
  expect(err.status).toBe(403);
});

test('answers 501 when the server has no Entra settings', async () => {
  delete process.env.ENTRA_STAFF_CLIENT_ID;
  const err = await refusal(verifyIdToken(idToken(), 'staff'));
  expect(err.status).toBe(501);
});

test('answers 400 with no token', async () => {
  expect((await refusal(verifyIdToken(undefined, 'staff'))).status).toBe(400);
});
