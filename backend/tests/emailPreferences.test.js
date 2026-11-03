// The site addresses are read when config/frontendUrl.js loads.
process.env.FRONTEND_URL = 'https://careers.example,https://staff.example,https://internal.example';
jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const emailPreferences = require('../src/services/emailPreferenceService');
const controller = require('../src/controllers/emailPreferenceController');
const { notifyCandidate } = require('../src/services/candidateNotificationService');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const GRACE = { id: 12, email: 'grace.namuli@caa.co.ug', candidateType: 'Internal', emailNotifications: true, emailNotificationsChangedAt: null, purgedAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-12';
  prisma.candidate.update.mockImplementation(async ({ data }) => ({ ...GRACE, ...data }));
});

describe('the unsubscribe token', () => {
  test('names its candidate and nobody else', () => {
    const token = emailPreferences.tokenFor(12);
    expect(emailPreferences.candidateIdFrom(token)).toBe(12);
    expect(emailPreferences.candidateIdFrom(`13${token.slice(2)}`)).toBeNull(); // another id, same signature
    expect(emailPreferences.candidateIdFrom(`${token}x`)).toBeNull();
    expect(emailPreferences.candidateIdFrom('12')).toBeNull();
    expect(emailPreferences.candidateIdFrom(undefined)).toBeNull();
  });

  test("links to the candidate's own site, and offers one-click unsubscribe", () => {
    const internal = emailPreferences.emailExtras(GRACE);
    expect(internal.footer).toContain('https://internal.example/email-preferences/12-');
    expect(internal.headers).toEqual({
      'List-Unsubscribe': expect.stringMatching(/^<https:\/\/internal\.example\/api\/candidates\/email-preferences\/12-.+\/unsubscribe>$/),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    });
    expect(emailPreferences.emailExtras({ ...GRACE, candidateType: 'External' }).footer).toContain('https://careers.example/email-preferences/12-');
  });
});

describe('notice emails', () => {
  test('go with a link to stop them', async () => {
    prisma.candidate.findUnique.mockResolvedValue(GRACE);
    await notifyCandidate(12, 'ApplicationSubmitted', 'We got your application.');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: GRACE.email, html: expect.stringContaining('Stop these emails'), headers: expect.objectContaining({ 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    }));
  });

  test('stop once turned off - the notice stays in-app', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ ...GRACE, emailNotifications: false });
    await notifyCandidate(12, 'ApplicationSubmitted', 'We got your application.');
    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.candidateNotification.create).toHaveBeenCalledTimes(1);
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ channel: 'InApp' }) });
  });
});

describe('changing it', () => {
  test('from the emailed link, without signing in - and audited as theirs', async () => {
    prisma.candidate.findUnique.mockResolvedValue(GRACE);
    const res = mockRes();
    await controller.updateByToken({ params: { token: emailPreferences.tokenFor(12) }, body: { emailNotifications: false } }, res);

    expect(prisma.candidate.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12 }, data: { emailNotifications: false, emailNotificationsChangedAt: expect.any(Date) }
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ emailNotifications: false, email: 'g***@caa.co.ug' }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'Candidate', entityId: 12, action: 'Notice emails turned off', payload: expect.objectContaining({ actor: { type: 'candidate', id: 12 }, via: 'link' })
    }) });
  });

  test('one-click unsubscribe from a mail client', async () => {
    prisma.candidate.findUnique.mockResolvedValue(GRACE);
    const res = mockRes();
    await controller.oneClickUnsubscribe({ params: { token: emailPreferences.tokenFor(12) } }, res);
    expect(prisma.candidate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ emailNotifications: false }) }));
  });

  test('a forged link or an erased account changes nothing', async () => {
    const res = mockRes();
    await controller.updateByToken({ params: { token: '12-forged' }, body: { emailNotifications: false } }, res);
    expect(res.status).toHaveBeenCalledWith(404);

    prisma.candidate.findUnique.mockResolvedValue({ ...GRACE, purgedAt: new Date() });
    await controller.oneClickUnsubscribe({ params: { token: emailPreferences.tokenFor(12) } }, mockRes());
    expect(prisma.candidate.update).not.toHaveBeenCalled();
  });

  test('from My profile, back on', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ ...GRACE, emailNotifications: false });
    const res = mockRes();
    await controller.updateMine({ user: { id: 12, type: 'candidate' }, body: { emailNotifications: true } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ emailNotifications: true }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'Notice emails turned on' }) });
  });

  test('needs a true or false', async () => {
    const res = mockRes();
    await controller.updateMine({ user: { id: 12 }, body: { emailNotifications: 'no' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
