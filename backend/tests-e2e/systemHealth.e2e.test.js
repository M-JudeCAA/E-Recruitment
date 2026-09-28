const request = require('supertest');
const { prisma, app, resetDatabase, createStaff, staffToken, api, expectStatus } = require('./helpers');
const { runJob } = require('../src/utils/jobRunner');

// The maintenance jobs, the staff warning banner, Director alerts, and the
// sign-in rate limits, all against the real database. Running every job's
// real query here also catches a job that no longer matches the schema.

let director;
let hroToken;

beforeEach(async () => {
  await resetDatabase();
  director = await createStaff('Director', 'director@caa.co.ug');
  await createStaff('HR_Officer', 'hro@caa.co.ug');
  hroToken = await staffToken('hro@caa.co.ug');
});

afterAll(async () => {
  await prisma.$disconnect();
});

const JOBS = {
  checkSlaEscalations: () => require('../scripts/checkSlaEscalations').run(),
  checkVacancyDeadlines: () => require('../scripts/checkVacancyDeadlines').run(),
  sendInterviewReminders: () => require('../scripts/sendInterviewReminders').run(),
  cleanupPendingRegistrations: () => require('../scripts/cleanupPendingRegistrations').run(),
  cleanupVerificationTokens: () => require('../scripts/cleanupVerificationTokens').run()
};
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

test('warns staff and alerts Directors once when the scheduled jobs have never run', async () => {
  const first = expectStatus(await api(hroToken).get('/api/dashboard/system-health'), 200).body;
  expect(first.warnings.join(' ')).toMatch(/Scheduled maintenance has not run/);

  // A second page load in the same day doesn't alert again.
  expectStatus(await api(hroToken).get('/api/dashboard/system-health'), 200);
  const alerts = await prisma.notification.findMany({ where: { recipientId: director.id, taskType: 'SystemHealthAlert' } });
  expect(alerts).toHaveLength(Object.keys(JOBS).length);
  expect(alerts.every((a) => a.channel === 'InApp')).toBe(true);
});

test('every job runs against the real schema, is recorded, and clears the warning', async () => {
  const staff = await prisma.staffUser.findFirst();
  await prisma.verificationToken.createMany({
    data: [
      { token: 'old-used', type: 'PasswordReset', staffId: staff.id, expiresAt: daysAgo(9), usedAt: daysAgo(10) },
      { token: 'old-expired', type: 'PasswordReset', staffId: staff.id, expiresAt: daysAgo(8) },
      { token: 'recent-expired', type: 'PasswordReset', staffId: staff.id, expiresAt: daysAgo(1) },
      { token: 'live', type: 'PasswordReset', staffId: staff.id, expiresAt: new Date(Date.now() + 3600000) }
    ]
  });

  for (const [name, run] of Object.entries(JOBS)) {
    const result = await runJob(name, run);
    expect({ name, ok: result.ok }).toEqual({ name, ok: true });
  }

  const remaining = (await prisma.verificationToken.findMany()).map((t) => t.token).sort();
  expect(remaining).toEqual(['live', 'recent-expired']);

  const rows = await prisma.systemHealth.findMany({ where: { key: { startsWith: 'job:' } } });
  expect(rows).toHaveLength(4);
  expect(rows.every((r) => r.lastSuccessAt && r.consecutiveFailures === 0)).toBe(true);

  const status = expectStatus(await api(hroToken).get('/api/dashboard/system-health'), 200).body;
  expect(status.warnings).toEqual([]);
});

test('reports failing email to staff, and alerts Directors only after repeated failures', async () => {
  const { sendMail } = require('../src/utils/mailer');
  const saved = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST; // every send now fails
  try {
    await sendMail({ to: 'a@example.com', subject: 'x', html: '' });
    let status = expectStatus(await api(hroToken).get('/api/dashboard/system-health'), 200).body;
    expect(status.mail.status).toBe('failing');
    expect(status.warnings.join(' ')).toMatch(/Emails are not being sent/);
    expect(await prisma.notification.count({ where: { taskType: 'SystemHealthAlert', message: { contains: 'Emails' } } })).toBe(0);

    await sendMail({ to: 'a@example.com', subject: 'x', html: '' });
    await sendMail({ to: 'a@example.com', subject: 'x', html: '' });
    expect(await prisma.notification.count({ where: { taskType: 'SystemHealthAlert', message: { contains: 'Emails' } } })).toBe(1);
  } finally {
    process.env.SMTP_HOST = saved;
  }

  // The next successful send clears the warning straight away.
  await sendMail({ to: 'a@example.com', subject: 'x', html: '' });
  const status = expectStatus(await api(hroToken).get('/api/dashboard/system-health'), 200).body;
  expect(status.mail.status).toBe('ok');
});

test('refuses the eleventh sign-in attempt on one account within 15 minutes', async () => {
  const attempt = () => request(app).post('/api/staff/auth/login').send({ email: 'director@caa.co.ug', password: 'wrong' });
  for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);

  const blocked = await attempt();
  expect(blocked.status).toBe(429);
  expect(blocked.headers['retry-after']).toBeDefined();
  expect(blocked.body.error).toMatch(/Too many attempts/);

  // Other accounts from the same address are unaffected.
  expect((await request(app).post('/api/staff/auth/login').send({ email: 'hro@caa.co.ug', password: 'wrong' })).status).toBe(401);
});
