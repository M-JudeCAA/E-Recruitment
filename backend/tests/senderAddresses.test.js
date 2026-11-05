// Two sender settings (SMTP_FROM_PUBLIC for the public, SMTP_FROM
// for everyone internal; one mailbox in production) - utils/mailer.js `from: 'public'`.
process.env.FRONTEND_URL = 'https://careers.example,https://staff.example,https://internal.example';
jest.mock('../src/config/db', () => require('./__mocks__/db'));

const mockTransport = { sendMail: jest.fn(), verify: jest.fn() };
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => mockTransport) }));

describe('the mailer', () => {
  const prisma = require('../src/config/db');
  const { sendMail, senderFor } = require('../src/utils/mailer');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_FROM = 'UCAA e-Recruitment <erecruitment@caa.co.ug>';
    process.env.SMTP_FROM_PUBLIC = 'UCAA Careers <careers@caa.co.ug>';
    prisma.systemHealth.findMany.mockResolvedValue([]);
    mockTransport.sendMail.mockResolvedValue({ messageId: 'x' });
  });
  afterAll(() => { delete process.env.SMTP_HOST; delete process.env.SMTP_FROM_PUBLIC; });

  test('from: public sends from SMTP_FROM_PUBLIC, anything else from SMTP_FROM', async () => {
    await sendMail({ from: 'public', to: 'a@example.test', subject: 'Hi', html: '<p>x</p>' });
    await sendMail({ to: 'b@caa.co.ug', subject: 'Hi', html: '<p>x</p>' });
    expect(mockTransport.sendMail.mock.calls.map(([m]) => m.from)).toEqual([
      'UCAA Careers <careers@caa.co.ug>', 'UCAA e-Recruitment <erecruitment@caa.co.ug>'
    ]);
  });

  test('without SMTP_FROM_PUBLIC everything goes from SMTP_FROM, as on UAT', () => {
    delete process.env.SMTP_FROM_PUBLIC;
    expect(senderFor('public')).toBe('UCAA e-Recruitment <erecruitment@caa.co.ug>');
  });
});

describe('who gets the public sender', () => {
  let sendMail;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/config/db', () => require('./__mocks__/db'));
    jest.doMock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) }));
    jest.doMock('../src/services/conflictOfInterestService', () => ({ isConflicted: jest.fn().mockResolvedValue(false) }));
    jest.doMock('../src/services/auditService', () => ({ record: jest.fn(), actorFrom: jest.fn(() => ({})) }));
    jest.doMock('../src/services/tokenService', () => ({ createToken: jest.fn().mockResolvedValue('tok') }));
    sendMail = require('../src/utils/mailer').sendMail;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-12';
  });

  const db = () => require('../src/config/db');
  const lastFrom = () => sendMail.mock.calls.at(-1)[0].from;

  test.each([
    ['External', 'public'],
    ['Internal', undefined]
  ])('a notice to an %s candidate', async (candidateType, from) => {
    db().candidate.findUnique.mockResolvedValue({ id: 3, email: 'c@example.test', fullName: 'C', candidateType, emailNotifications: true });
    const { notifyCandidate } = require('../src/services/candidateNotificationService');
    await notifyCandidate(3, 'ApplicationSubmitted', 'We got your application.');
    expect(lastFrom()).toBe(from);
  });

  test('a password reset (only External candidates have passwords)', async () => {
    db().candidate.findUnique.mockResolvedValue({ id: 3, email: 'c@example.test', fullName: 'C', passwordHash: 'x', candidateType: 'External' });
    const { forgotPassword } = require('../src/controllers/candidateAuthController');
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), locals: {} };
    await forgotPassword({ body: { email: 'c@example.test' } }, res);
    expect(lastFrom()).toBe('public');
  });

  test('a bulk email: External candidates from careers@, employees from erecruitment@', async () => {
    db().candidate.findMany.mockResolvedValue([
      { id: 1, fullName: 'Ext', email: 'ext@example.test', purgedAt: null, candidateType: 'External', emailNotifications: true, applications: [] },
      { id: 2, fullName: 'Int', email: 'int@caa.co.ug', purgedAt: null, candidateType: 'Internal', emailNotifications: true, applications: [] }
    ]);
    db().bulkEmail.create.mockResolvedValue({ id: 5 });
    const { send } = require('../src/controllers/bulkEmailController');
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await send({ body: { candidateIds: [1, 2], subject: 'News', body: '<p>Hello</p>' }, user: { id: 9, type: 'staff' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(Object.fromEntries(sendMail.mock.calls.map(([m]) => [m.to, m.from]))).toEqual({
      'ext@example.test': 'public', 'int@caa.co.ug': undefined
    });
  });
});
