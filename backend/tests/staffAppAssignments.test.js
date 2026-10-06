// Who is assigned to the staff app in Entra (directoryService.staffAppAssignments):
// the Graph calls are stood in for by a fake fetch answering per URL.
const directory = require('../src/services/directoryService');

const realFetch = global.fetch;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  Object.assign(process.env, {
    ENTRA_TENANT_ID: 't', ENTRA_STAFF_CLIENT_ID: 'staff-app', ENTRA_DIRECTORY_CLIENT_SECRET: 's', INTERNAL_EMAIL_DOMAIN: 'caa.co.ug'
  });
});
afterEach(() => { global.fetch = realFetch; });

const user = (id, name, extra = {}) => ({
  id, displayName: name, mail: `${name.split(' ')[0].toLowerCase()}@caa.co.ug`, userPrincipalName: `${id}@caa.co.ug`,
  jobTitle: 'HR Officer', department: 'HR', accountEnabled: true, ...extra
});

function graph(routes) {
  global.fetch = jest.fn((url) => {
    if (url.includes('login.microsoftonline.com')) return json(200, { access_token: 'tok', expires_in: 3600 });
    const hit = Object.entries(routes).find(([part]) => decodeURIComponent(url).includes(part));
    return hit ? json(200, hit[1]) : json(404, { error: { code: 'NotFound' } });
  });
}

describe('people assigned to the staff app in Entra', () => {
  test('direct and group assignments, newest first; disabled, guest and outside accounts left out', async () => {
    graph({
      "servicePrincipals(appId='staff-app')": { id: 'sp1' },
      '/servicePrincipals/sp1/appRoleAssignedTo': {
        value: [
          { principalType: 'User', principalId: 'u1', createdDateTime: '2026-10-01T08:00:00Z' },
          { principalType: 'User', principalId: 'u2', createdDateTime: '2026-10-05T08:00:00Z' },
          { principalType: 'Group', principalId: 'g1', principalDisplayName: 'HR Team', createdDateTime: '2026-09-01T08:00:00Z' }
        ]
      },
      '/users?$filter=id in': {
        value: [user('u1', 'Grace Namuli'), user('u2', 'Disabled Person', { accountEnabled: false })]
      },
      '/groups/g1/members/microsoft.graph.user': {
        value: [
          user('u3', 'Peter Okello'),
          user('u4', 'Guest Person', { userPrincipalName: 'guest_gmail.com#EXT#@caa.co.ug' }),
          user('u5', 'Outside Person', { mail: 'outside@example.com' }),
          user('u1', 'Grace Namuli') // also assigned directly - one entry, the earlier assignment
        ]
      }
    });

    const people = await directory.staffAppAssignments();

    expect(people.map((p) => p.entraObjectId).sort()).toEqual(['u1', 'u3']);
    expect(people.find((p) => p.entraObjectId === 'u3')).toEqual({
      entraObjectId: 'u3', name: 'Peter Okello', email: 'peter@caa.co.ug', jobTitle: 'HR Officer', department: 'HR',
      assignedAt: '2026-09-01T08:00:00Z', via: 'HR Team'
    });
    // Grace is in the group (Sept) and was also added directly (Oct): the earlier one stands.
    expect(people.find((p) => p.entraObjectId === 'u1')).toEqual(expect.objectContaining({ assignedAt: '2026-09-01T08:00:00Z', via: 'HR Team' }));
  });

  test('newest assignment first', async () => {
    graph({
      "servicePrincipals(appId='staff-app')": { id: 'sp1' },
      '/servicePrincipals/sp1/appRoleAssignedTo': {
        value: [
          { principalType: 'User', principalId: 'u1', createdDateTime: '2026-10-01T08:00:00Z' },
          { principalType: 'User', principalId: 'u3', createdDateTime: '2026-10-05T08:00:00Z' }
        ]
      },
      '/users?$filter=id in': { value: [user('u1', 'Grace Namuli'), user('u3', 'Peter Okello')] }
    });

    expect((await directory.staffAppAssignments()).map((p) => p.name)).toEqual(['Peter Okello', 'Grace Namuli']);
  });

  test('a refusal from Graph (permission not granted) comes back with its status', async () => {
    global.fetch = jest.fn((url) => (url.includes('login.microsoftonline.com')
      ? json(200, { access_token: 'tok2', expires_in: 3600 })
      : json(403, { error: { code: 'Authorization_RequestDenied' } })));
    await expect(directory.staffAppAssignments()).rejects.toMatchObject({ status: 403 });
  });
});
