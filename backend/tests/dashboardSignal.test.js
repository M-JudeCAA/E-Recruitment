const { signalDashboards, verifySignal, sign } = require('../src/utils/dashboardSignal');

const realFetch = global.fetch;
beforeEach(() => { process.env.JWT_SECRET = 'test-secret'; });
afterEach(() => { global.fetch = realFetch; });

const request = (timestamp, event, payload, signature = sign(timestamp, event, payload)) => ({
  headers: { 'x-signal-timestamp': timestamp, 'x-signal-signature': signature }, body: { event, payload }
});

describe('the scheduler worker\'s signal to the dashboards', () => {
  test('posts a signed signal the API accepts', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    expect(await signalDashboards('MaintenanceRun', { jobs: ['expireOffers'] })).toBe(true);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/dashboard-events$/);
    expect(verifySignal({
      headers: { 'x-signal-timestamp': options.headers['X-Signal-Timestamp'], 'x-signal-signature': options.headers['X-Signal-Signature'] },
      body: JSON.parse(options.body)
    })).toBe(true);
  });

  test('never throws when the API is not there', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await signalDashboards('MaintenanceRun')).toBe(false);
  });

  test('refuses a wrong signature, a changed body, an old signal and a missing secret', () => {
    const now = String(Date.now());
    expect(verifySignal(request(now, 'MaintenanceRun', { jobs: ['a'] }, 'f'.repeat(64)))).toBe(false);
    const tampered = request(now, 'MaintenanceRun', { jobs: ['a'] });
    tampered.body.event = 'SomethingElse';
    expect(verifySignal(tampered)).toBe(false);
    const old = String(Date.now() - 5 * 60 * 1000);
    expect(verifySignal(request(old, 'MaintenanceRun', {}))).toBe(false);
    expect(verifySignal({ headers: {}, body: {} })).toBe(false);
    const valid = request(now, 'MaintenanceRun', {});
    delete process.env.JWT_SECRET;
    expect(verifySignal(valid)).toBe(false);
  });
});
