// The Graph calls behind the staff app's group (directoryService), with
// fetch standing in for Microsoft.
const directory = require('../src/services/directoryService');

const GROUP = '11111111-2222-3333-4444-555555555555';
const USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const answer = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const graphError = (status, message) => answer(status, { error: { code: 'Request_BadRequest', message } });

let calls;
function graph(...responses) {
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    if (String(url).includes('/oauth2/v2.0/token')) return answer(200, { access_token: 't', expires_in: 3600 });
    return responses.shift() || answer(500);
  });
}

beforeAll(() => {
  process.env.ENTRA_TENANT_ID = 'tenant';
  process.env.ENTRA_DIRECTORY_CLIENT_ID = 'client';
  process.env.ENTRA_DIRECTORY_CLIENT_SECRET = 'secret';
});
afterAll(() => { delete global.fetch; });

describe('adding to the group', () => {
  test('posts a reference to the person', async () => {
    graph(answer(204));
    await directory.addGroupMember(GROUP, USER);
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/members/$ref'));
    expect(post.url).toBe(`https://graph.microsoft.com/v1.0/groups/${GROUP}/members/$ref`);
    expect(JSON.parse(post.body)).toEqual({ '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${USER}` });
  });

  test('someone already in it counts as done', async () => {
    graph(graphError(400, "One or more added object references already exist for the following modified properties: 'members'."));
    await expect(directory.addGroupMember(GROUP, USER)).resolves.toBeUndefined();
  });

  test('a refusal comes back with its status', async () => {
    graph(graphError(403, 'Insufficient privileges to complete the operation.'));
    await expect(directory.addGroupMember(GROUP, USER)).rejects.toMatchObject({ status: 403 });
  });
});

describe('removing from the group', () => {
  test('someone who is not a member counts as done', async () => {
    graph(graphError(404, 'Resource does not exist.'), answer(200, { id: GROUP }));
    await expect(directory.removeGroupMember(GROUP, USER)).resolves.toBeUndefined();
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/groups/${GROUP}/members/${USER}/$ref`))).toBe(true);
  });

  test('a group that does not exist is an error', async () => {
    graph(graphError(404, 'Resource does not exist.'), graphError(404, 'Resource does not exist.'));
    await expect(directory.removeGroupMember(GROUP, USER)).rejects.toMatchObject({ status: 404 });
  });
});

describe('finding someone by email', () => {
  test('matches the mail address or the sign-in name', async () => {
    graph(answer(200, { value: [{ id: USER }] }));
    await expect(directory.findUserIdByEmail("O'Neil@caa.co.ug")).resolves.toBe(USER);
    const lookup = decodeURIComponent(calls.find((c) => c.url.includes('/users?')).url);
    expect(lookup).toContain("mail eq 'o''neil@caa.co.ug' or userPrincipalName eq 'o''neil@caa.co.ug'");
  });
});
