jest.mock('../src/config/db', () => require('./__mocks__/db'));

const mockTransport = { sendMail: jest.fn(), verify: jest.fn() };
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => mockTransport) }));

const prisma = require('../src/config/db');

// The mailer reads SMTP_HOST when it builds the transport and on every send,
// and keeps a little state (success-write throttling), so each test loads a
// fresh copy with the environment it needs.
function loadMailer(env = { SMTP_HOST: 'smtp.example.test' }) {
  const saved = process.env.SMTP_HOST;
  if (env.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = env.SMTP_HOST;
  let mailer;
  jest.isolateModules(() => { mailer = require('../src/utils/mailer'); });
  return { mailer, restore: () => { if (saved === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = saved; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.systemHealth.findMany.mockResolvedValue([]);
  prisma.systemHealth.updateMany.mockResolvedValue({ count: 0 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// Only the "mail" rows - a failed send also runs the full health check,
// which may create rows for scheduled jobs that have never run.
const upsertKeys = () => prisma.systemHealth.upsert.mock.calls.map((c) => c[0]).filter((a) => a.where.key === 'mail');

describe('sendMail', () => {
  test('sends, records a success, and returns the transport result', async () => {
    const { mailer, restore } = loadMailer();
    mockTransport.sendMail.mockResolvedValue({ messageId: 'abc' });

    const info = await mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '<p>x</p>' });

    expect(info).toEqual({ messageId: 'abc' });
    expect(upsertKeys()).toEqual([expect.objectContaining({ where: { key: 'mail' }, update: expect.objectContaining({ consecutiveFailures: 0 }) })]);
    restore();
  });

  test('does not write a fresh success row for every email while mail is healthy', async () => {
    const { mailer, restore } = loadMailer();
    mockTransport.sendMail.mockResolvedValue({ messageId: 'abc' });

    await mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '' });
    await mailer.sendMail({ to: 'c@d.test', subject: 'Hi', html: '' });

    expect(upsertKeys()).toHaveLength(1);
    restore();
  });

  test('returns null instead of throwing on failure, and records the failure', async () => {
    const { mailer, restore } = loadMailer();
    mockTransport.sendMail.mockRejectedValue(new Error('Invalid login'));

    const info = await mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '' });

    expect(info).toBeNull();
    expect(upsertKeys()).toEqual([expect.objectContaining({
      where: { key: 'mail' }, update: expect.objectContaining({ lastError: 'Invalid login', consecutiveFailures: { increment: 1 } })
    })]);
    // The failure path also checks whether Directors need alerting.
    expect(prisma.systemHealth.findMany).toHaveBeenCalled();
    restore();
  });

  test('always records the first success after a failure, so the warning clears straight away', async () => {
    const { mailer, restore } = loadMailer();
    mockTransport.sendMail.mockResolvedValueOnce({ messageId: 'ok' })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ messageId: 'ok again' });

    await mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '' });
    await mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '' });
    await mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '' });

    const updates = upsertKeys().map((c) => c.update);
    expect(updates).toHaveLength(3);
    expect(updates[2]).toEqual(expect.objectContaining({ consecutiveFailures: 0 }));
    restore();
  });

  test('records a failure without trying to send when SMTP_HOST is not set', async () => {
    const { mailer, restore } = loadMailer({ SMTP_HOST: undefined });

    const info = await mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '' });

    expect(info).toBeNull();
    expect(mockTransport.sendMail).not.toHaveBeenCalled();
    expect(upsertKeys()[0].update.lastError).toBe('SMTP_HOST is not set');
    restore();
  });

  test('never throws when recording health fails', async () => {
    const { mailer, restore } = loadMailer();
    mockTransport.sendMail.mockResolvedValue({ messageId: 'abc' });
    prisma.systemHealth.upsert.mockRejectedValueOnce(new Error('database down'));

    await expect(mailer.sendMail({ to: 'a@b.test', subject: 'Hi', html: '' })).resolves.toEqual({ messageId: 'abc' });
    restore();
  });
});

describe('verifyMailTransport', () => {
  test('records a success when the SMTP server accepts the connection', async () => {
    const { mailer, restore } = loadMailer();
    mockTransport.verify.mockResolvedValue(true);

    await expect(mailer.verifyMailTransport()).resolves.toBe(true);
    expect(upsertKeys()[0].update).toEqual(expect.objectContaining({ consecutiveFailures: 0 }));
    restore();
  });

  test('records a failure at start-up when the SMTP settings are wrong', async () => {
    const { mailer, restore } = loadMailer();
    mockTransport.verify.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(mailer.verifyMailTransport()).resolves.toBe(false);
    expect(upsertKeys()[0].update.lastError).toMatch(/^Start-up check failed: getaddrinfo ENOTFOUND/);
    restore();
  });

  test('reports a missing SMTP_HOST at start-up', async () => {
    const { mailer, restore } = loadMailer({ SMTP_HOST: undefined });

    await expect(mailer.verifyMailTransport()).resolves.toBe(false);
    expect(mockTransport.verify).not.toHaveBeenCalled();
    restore();
  });
});
