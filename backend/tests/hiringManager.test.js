jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) }));
const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const hiringManagers = require('../src/services/hiringManagerService');
const directory = require('../src/services/directoryService');

const vacancy = { id: 3, title: 'Air Traffic Controller', jobRef: 'UCAA/ADV/EXT/001/2026', hiringManagerName: 'Stephen Tumwine', hiringManagerEmail: 'stephen.tumwine@caa.co.ug', deadline: new Date('2026-11-02T14:00:00Z') };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_EMAIL_DOMAIN = 'caa.co.ug';
});

describe('choosing the hiring manager', () => {
  test('a UCAA employee, by name and UCAA email; null clears it', () => {
    expect(hiringManagers.parseHiringManager({ name: ' Stephen Tumwine ', email: 'Stephen.Tumwine@caa.co.ug', entraObjectId: '0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0', jobTitle: 'Director ANS' }))
      .toEqual({ data: { hiringManagerName: 'Stephen Tumwine', hiringManagerEmail: 'stephen.tumwine@caa.co.ug', hiringManagerEntraId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', hiringManagerJobTitle: 'Director ANS' } });
    expect(hiringManagers.parseHiringManager({ name: 'Outsider', email: 'someone@gmail.com' }).error).toMatch(/UCAA employee/);
    expect(hiringManagers.parseHiringManager({ name: 'X', email: 'x@caa.co.ug' }).error).toMatch(/name/);
    expect(hiringManagers.parseHiringManager(null).data).toEqual({ hiringManagerName: null, hiringManagerEmail: null, hiringManagerEntraId: null, hiringManagerJobTitle: null });
  });
});

describe('progress emails', () => {
  test('emails the hiring manager at a milestone, naming the vacancy', async () => {
    expect(await hiringManagers.notify(vacancy, 'shortlistApproved', { names: ['Amy <script>', 'Ben'] })).toBe(true);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('stephen.tumwine@caa.co.ug');
    expect(mail.subject).toBe('Recruitment update: Air Traffic Controller (UCAA/ADV/EXT/001/2026) - interview shortlist approved');
    expect(mail.html).toContain('Dear Stephen Tumwine');
    expect(mail.html).toContain('Amy &lt;script&gt;');
  });

  test('loads the vacancy by id; nothing is sent when it has no hiring manager, and a failure never throws', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ ...vacancy, hiringManagerEmail: null });
    expect(await hiringManagers.notify(3, 'published')).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    expect(await hiringManagers.notify(vacancy, 'applicationsClosed', { count: 12 })).toBe(false);
  });

  test.each(Object.keys(hiringManagers.MESSAGES))('%s has a subject and a body', (event) => {
    const { subject, body } = hiringManagers.MESSAGES[event](vacancy, {
      count: 2, names: ['A'], primary: ['A'], reserve: [], candidateName: 'A', outcome: 'declined', from: new Date(), to: new Date(), reason: 'r'
    });
    expect(subject).toBeTruthy();
    expect(body).toMatch(/^<p>/);
  });
});

describe('directory search', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('is off until the directory secret is set', () => {
    delete process.env.ENTRA_DIRECTORY_CLIENT_SECRET;
    expect(directory.isConfigured()).toBe(false);
  });

  test('searches Graph by name or email and keeps enabled UCAA accounts only', async () => {
    Object.assign(process.env, { ENTRA_TENANT_ID: 't', ENTRA_STAFF_CLIENT_ID: 'c', ENTRA_DIRECTORY_CLIENT_SECRET: 's' });
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: [
        { id: 'a1', displayName: 'Stephen Tumwine', mail: 'Stephen.Tumwine@caa.co.ug', jobTitle: 'Director ANS', department: 'ANS' },
        { id: 'b2', displayName: 'Guest User', mail: 'guest@gmail.com' }
      ] }) });
    expect(directory.isConfigured()).toBe(true);
    const people = await directory.searchPeople('Stephen "x');
    expect(people).toEqual([{ entraObjectId: 'a1', name: 'Stephen Tumwine', email: 'stephen.tumwine@caa.co.ug', jobTitle: 'Director ANS', department: 'ANS' }]);
    const [url, options] = global.fetch.mock.calls[1];
    expect(new URL(url).searchParams.get('$search')).toBe('"displayName:Stephen  x" OR "mail:Stephen  x"');
    expect(options.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer tok', ConsistencyLevel: 'eventual' }));
    expect(await directory.searchPeople('a')).toEqual([]); // too short
  });
});
