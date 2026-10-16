import { AxiosError } from 'axios';
import client, {
  API_URL, OFFLINE_MESSAGE, SERVER_ERROR_MESSAGE, SESSION_ENDED_EVENT, TIMEOUT_MESSAGE
} from '../../src/models/apiClient';
import staffClient from '../../src/models/staffApiClient';
import { approveVacancy } from '../../src/utils/approveVacancy';
import { documentUrls } from '../../src/components/DocumentPreview';

// No network: each test says how "the server" answers.
let sent;
const answers = (respond) => {
  client.defaults.adapter = async (config) => {
    sent.push(config);
    const { status = 200, data = {}, networkError } = respond(config, sent.length);
    if (networkError) throw new AxiosError(networkError.message || 'Network Error', networkError.code || 'ERR_NETWORK', config);
    const response = { status, data, headers: {}, config };
    if (status >= 400) throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, null, response);
    return response;
  };
};
const failure = (promise) => promise.then(() => { throw new Error('expected the request to fail'); }, (err) => err);

beforeEach(() => {
  sent = [];
  answers(() => ({ status: 200 }));
});

describe('which session a request carries', () => {
  beforeEach(() => {
    localStorage.setItem('candidateToken', 'candidate-jwt');
    localStorage.setItem('staffToken', 'staff-jwt');
  });

  test('a candidate call carries the candidate\'s token', async () => {
    await client.get('/api/candidates/me');
    expect(sent[0].headers.Authorization).toBe('Bearer candidate-jwt');
  });

  test('a staff call carries the staff token, on every method', async () => {
    await staffClient.get('/api/vacancies/admin');
    await staffClient.post('/api/vacancies', {});
    await staffClient.patch('/api/vacancies/1', {});
    await staffClient.put('/api/positions/1/headcount', {});
    await staffClient.delete('/api/positions/1');
    expect(sent.map((c) => c.headers.Authorization)).toEqual(Array(5).fill('Bearer staff-jwt'));
    expect(sent.map((c) => c.method)).toEqual(['get', 'post', 'patch', 'put', 'delete']);
  });

  test('signed out, nothing is sent', async () => {
    localStorage.clear();
    await client.get('/api/vacancies');
    await staffClient.get('/api/vacancies/admin');
    expect(sent.every((c) => c.headers.Authorization === undefined)).toBe(true);
  });

  test('requests go to the API, not the site', async () => {
    await client.get('/api/vacancies');
    expect(sent[0].baseURL).toBe(API_URL);
  });
});

// Every screen shows err.response.data.error - so it must never be a raw
// library message or anything a server failure carried.
describe('what a failed request says', () => {
  test('a deliberate refusal is passed on as it is', async () => {
    answers(() => ({ status: 409, data: { error: 'This vacancy was already updated', code: 'VACANCY_CHANGED' } }));
    const err = await failure(client.get('/api/vacancies/1'));
    expect(err.response.status).toBe(409);
    expect(err.response.data).toEqual({ error: 'This vacancy was already updated', code: 'VACANCY_CHANGED' });
  });

  test('no answer at all reads as the server being offline', async () => {
    answers(() => ({ networkError: {} }));
    const err = await failure(client.get('/api/vacancies'));
    expect(err.response).toEqual({ status: 503, data: { error: OFFLINE_MESSAGE } });
  });

  test('a timeout says so', async () => {
    answers(() => ({ networkError: { code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' } }));
    const err = await failure(client.get('/api/vacancies'));
    expect(err.response).toEqual(expect.objectContaining({ status: 504, data: { error: TIMEOUT_MESSAGE } }));
  });

  test('a server error never shows what the server said', async () => {
    answers(() => ({ status: 500, data: { error: 'Invalid `prisma.vacancy.findMany()` invocation: Can\'t reach database server at db:3306' } }));
    const err = await failure(client.get('/api/vacancies'));
    expect(err.response.data).toEqual({ error: SERVER_ERROR_MESSAGE });
  });

  test.each([502, 503, 504])('a %i from the proxy means the API can\'t be reached', async (status) => {
    answers(() => ({ status, data: '<html>Bad Gateway</html>' }));
    const err = await failure(client.get('/api/vacancies'));
    expect(err.response.data).toEqual({ error: OFFLINE_MESSAGE });
  });

  test('but the API\'s own coded 502/503 keeps its message', async () => {
    answers(() => ({ status: 502, data: { error: 'Microsoft Graph refused the request', code: 'DIRECTORY_FAILED' } }));
    const err = await failure(client.get('/api/directory/people'));
    expect(err.response.data.error).toBe('Microsoft Graph refused the request');
  });

  test('a feature not set up on this server (501) keeps its message', async () => {
    answers(() => ({ status: 501, data: { error: 'Directory search is not set up', code: 'DIRECTORY_NOT_CONFIGURED' } }));
    const err = await failure(client.get('/api/directory/people'));
    expect(err.response.data.code).toBe('DIRECTORY_NOT_CONFIGURED');
  });
});

// A 401 on a request that carried a session ends that session in the
// browser too (AuthContext listens for the event).
describe('a session the API no longer accepts', () => {
  let ended;
  const listen = (e) => ended.push(e.detail);
  beforeEach(() => {
    ended = [];
    window.addEventListener(SESSION_ENDED_EVENT, listen);
    answers(() => ({ status: 401, data: { error: 'Your staff account is no longer active' } }));
  });
  afterEach(() => window.removeEventListener(SESSION_ENDED_EVENT, listen));

  test('ends the staff session, with the API\'s reason', async () => {
    localStorage.setItem('staffToken', 'staff-jwt');
    await failure(staffClient.get('/api/dashboard/inbox'));
    expect(ended).toEqual([{ kind: 'staff', message: 'Your staff account is no longer active' }]);
  });

  test('ends the candidate session', async () => {
    localStorage.setItem('candidateToken', 'candidate-jwt');
    await failure(client.get('/api/candidates/me'));
    expect(ended).toEqual([expect.objectContaining({ kind: 'candidate' })]);
  });

  test('wrong credentials at sign-in are not an ended session', async () => {
    localStorage.setItem('candidateToken', 'candidate-jwt');
    const err = await failure(client.post('/api/candidates/auth/login', { email: 'a@b.com', password: 'wrong' }));
    expect(err.response.status).toBe(401);
    expect(ended).toEqual([]);
  });

  test('nor is a 401 for a visitor who was never signed in', async () => {
    await failure(client.get('/api/candidates/me'));
    expect(ended).toEqual([]);
  });
});

// An exception the approver must authorise is asked about, then sent again.
describe('approving a vacancy', () => {
  const vacancy = { id: 7, updatedAt: '2026-10-01T08:00:00.000Z' };
  const body = (config) => JSON.parse(config.data);
  beforeEach(() => localStorage.setItem('staffToken', 'staff-jwt'));

  test('pins the approval to the version the approver saw', async () => {
    const confirm = vi.fn();
    await approveVacancy(vacancy, confirm);
    expect(sent[0].url).toBe('/api/vacancies/7/approve');
    expect(body(sent[0])).toEqual({ expectedUpdatedAt: vacancy.updatedAt });
    expect(confirm).not.toHaveBeenCalled();
  });

  test('asks before authorising an unapproved job description, then approves with the flag', async () => {
    answers((config, call) => (call === 1
      ? { status: 422, data: { error: 'The job description is not approved (reason given: urgent)', code: 'JD_EXCEPTION_NOT_AUTHORISED' } }
      : { status: 200, data: { id: 7, status: 'Open' } }));
    const confirm = vi.fn().mockResolvedValue(true);
    const response = await approveVacancy(vacancy, confirm);
    expect(confirm).toHaveBeenCalledWith('The job description is not approved (reason given: urgent)',
      expect.objectContaining({ confirmLabel: 'Authorise and approve' }));
    expect(body(sent[1])).toEqual({ expectedUpdatedAt: vacancy.updatedAt, authoriseJdException: true });
    expect(response.data.status).toBe('Open');
  });

  test('a vacancy with both exceptions is asked about twice', async () => {
    answers((config, call) => ({
      1: { status: 422, data: { error: 'JD', code: 'JD_EXCEPTION_NOT_AUTHORISED' } },
      2: { status: 422, data: { error: 'Headcount', code: 'HEADCOUNT_EXCEPTION_NOT_AUTHORISED' } },
      3: { status: 200 }
    }[call]));
    const confirm = vi.fn().mockResolvedValue(true);
    await approveVacancy(vacancy, confirm);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(body(sent[2])).toEqual(expect.objectContaining({ authoriseJdException: true, authoriseHeadcountException: true }));
  });

  test('declining leaves the vacancy unapproved', async () => {
    answers(() => ({ status: 422, data: { error: 'JD', code: 'JD_EXCEPTION_NOT_AUTHORISED' } }));
    expect(await approveVacancy(vacancy, vi.fn().mockResolvedValue(false))).toBeNull();
    expect(sent).toHaveLength(1);
  });

  test('any other refusal is the caller\'s to show - and it never loops', async () => {
    answers(() => ({ status: 409, data: { error: 'This vacancy has changed', code: 'VACANCY_CHANGED' } }));
    const confirm = vi.fn();
    const err = await failure(approveVacancy(vacancy, confirm));
    expect(err.response.data.code).toBe('VACANCY_CHANGED');
    expect(confirm).not.toHaveBeenCalled();

    // The API still refusing after the flag was sent is passed on, not asked again.
    sent = [];
    answers(() => ({ status: 422, data: { error: 'JD', code: 'JD_EXCEPTION_NOT_AUTHORISED' } }));
    await failure(approveVacancy(vacancy, vi.fn().mockResolvedValue(true)));
    expect(sent).toHaveLength(2);
  });
});

// The file itself is the one place a token goes in the address (CLAUDE.md,
// File access): a frame, an image or a download link can't set a header.
// The viewer's preview is fetched with the header instead.
test('a document is shown and downloaded from the API with the session\'s token, its preview fetched without one', () => {
  localStorage.setItem('staffToken', 'staff-jwt');
  localStorage.setItem('candidateToken', 'candidate-jwt');
  const staff = documentUrls('/api/files/cover-letter-1.pdf', { name: 'Cover letter' });
  expect(staff.view).toBe(`${API_URL}/api/files/cover-letter-1.pdf?token=staff-jwt`);
  expect(staff.download).toBe(`${API_URL}/api/files/cover-letter-1.pdf?download=1&name=Cover+letter&token=staff-jwt`);
  expect(staff.preview).toBe('/api/files/cover-letter-1.pdf/preview');
  expect(documentUrls('/api/files/a.pdf', { audience: 'candidate' }).view).toBe(`${API_URL}/api/files/a.pdf?token=candidate-jwt`);
  // A committee member's link already carries their access.
  expect(documentUrls('/api/shortlist-panel/t1/files/a.pdf', { audience: 'committee' }).view).toBe(`${API_URL}/api/shortlist-panel/t1/files/a.pdf`);
});
