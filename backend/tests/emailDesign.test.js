// Read when config/frontendUrl.js loads.
process.env.FRONTEND_URL = 'https://careers.example,https://staff.example,https://internal.example';
jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const { renderEmail, isDocument, toText } = require('../src/utils/emailLayout');
const { noticeEmail, notifyCandidate, EMAILS } = require('../src/services/candidateNotificationService');
const { emailBody } = require('../src/services/notificationService');

const GRACE = { id: 4, fullName: 'Grace <Namuli>', email: 'grace@caa.co.ug', candidateType: 'Internal', emailNotifications: true };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-12';
});

describe('the email layout', () => {
  test('is a whole document, escapes what it is given, and reads as plain text', () => {
    const html = renderEmail({
      audience: 'candidate', title: 'Hello & welcome', greeting: 'Dear <b>Ann</b>,', text: 'Line one.\n\nLine <two>.',
      quote: { label: 'HR’s comment', text: 'Wrong <number>' }, button: { label: 'Open', url: 'https://x.example/a?b=1&c=2' }
    });
    expect(isDocument(html)).toBe(true);
    expect(html).toContain('Hello &amp; welcome');
    expect(html).toContain('Dear &lt;b&gt;Ann&lt;/b&gt;,');
    expect(html).not.toContain('<two>');
    expect(html).toContain('href="https://x.example/a?b=1&amp;c=2"');

    const text = toText(html);
    expect(text).toContain('Hello & welcome');
    expect(text).toContain('Line <two>.');
    expect(text).toContain('Wrong <number>');
    expect(text).toContain('Open (https://x.example/a?b=1&c=2)');
    expect(text).not.toMatch(/<td|style=/);
  });
});

describe('candidate notice emails', () => {
  test('a discrepancy: its own subject, a greeting, HR’s comment set apart, a button to their profile and the unsubscribe link', () => {
    const email = noticeEmail(GRACE, 'EmploymentDiscrepancy', 'Your details don’t match.', { quote: { label: 'HR’s comment', text: 'Employee number is UCAA1234.' } });
    expect(email.subject).toBe('Your UCAA employment details need correcting - UCAA e-Recruitment');
    expect(email.html).toContain('Dear Grace &lt;Namuli&gt;,');
    expect(email.html).toContain('HR’s comment');
    expect(email.html).toContain('Employee number is UCAA1234.');
    expect(email.html).toContain('href="https://internal.example/careers/profile"');
    expect(email.html).toContain('Stop these emails');
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('an External candidate is sent to their applications on the public site', () => {
    const email = noticeEmail({ ...GRACE, candidateType: 'External' }, 'InterviewScheduled', 'Come on Monday.');
    expect(email.subject).toBe('You are invited to an interview - UCAA e-Recruitment');
    expect(email.html).toContain('href="https://careers.example/dashboard/applications"');
    expect(email.html).toContain('View my applications');
  });

  test('every kind of notice has a heading of its own', () => {
    for (const { title } of Object.values(EMAILS)) expect(title).toMatch(/^[A-Z]/);
  });

  test('HR’s comment is in the in-app notice too', async () => {
    prisma.candidate.findUnique.mockResolvedValue({ ...GRACE, emailNotifications: false });
    await notifyCandidate(4, 'EmploymentDiscrepancy', 'Your details don’t match.', { quote: { label: 'HR’s comment', text: 'Wrong number.' } });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      channel: 'InApp', message: 'Your details don’t match. HR’s comment: “Wrong number.”'
    }) });
  });
});

describe('staff emails', () => {
  test('wear the same design, the subject as heading, with the button', () => {
    const html = emailBody('Ann raised <X> for approval.', '/hr/inbox', null, 'Approval needed: vacancy');
    expect(isDocument(html)).toBe(true);
    expect(html).toContain('Approval needed: vacancy');
    expect(html).toContain('Ann raised &lt;X&gt; for approval.');
    expect(html).toContain('Open in e-Recruitment');
    expect(html).toContain('Staff workspace');
  });
});
