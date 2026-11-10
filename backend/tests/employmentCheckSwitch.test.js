jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(true) }));

// EMPLOYMENT_CHECK_REQUIRED=false - HR's employment check switched off, for
// the test (UAT) server only (utils/employmentCheck.js).
const prisma = require('../src/config/db');
const { employmentCheck, employmentCheckRequired } = require('../src/utils/employmentCheck');
const workflow = require('../src/services/workflowService');
const verification = require('../src/services/internalVerificationService');
const inbox = require('../src/services/inboxService');
const { productionProblems } = require('../src/config/productionChecks');
const reminders = require('../scripts/sendDiscrepancyReminders');

const pending = { candidateType: 'Internal', internalProfile: { departmentId: 4, verificationStatus: 'Pending', verificationEvidenceType: null } };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EMPLOYMENT_CHECK_REQUIRED = 'false';
});
afterAll(() => { delete process.env.EMPLOYMENT_CHECK_REQUIRED; });

test('is on unless set to false', () => {
  delete process.env.EMPLOYMENT_CHECK_REQUIRED;
  expect(employmentCheckRequired()).toBe(true);
  expect(employmentCheck(pending)).toEqual(expect.objectContaining({ required: true, verified: false }));
  process.env.EMPLOYMENT_CHECK_REQUIRED = ' FALSE ';
  expect(employmentCheckRequired()).toBe(false);
});

test('off: an unverified internal candidate counts as clear to submit, with nothing to say', () => {
  expect(employmentCheck(pending)).toEqual({ required: false, verified: true, status: 'Pending', message: null });
});

test('off: they can be shortlisted', async () => {
  prisma.application.findUnique.mockResolvedValue({ status: 'UnderReview', candidate: pending });
  await expect(workflow.assertCanShortlist(1)).resolves.toBeUndefined();
});

test('off: no committee warning, no Inbox item, no discrepancy reminders', async () => {
  await expect(verification.unverifiedApplicants(3)).resolves.toEqual([]);
  expect(prisma.application.findMany).not.toHaveBeenCalled();

  prisma.delegation.findFirst.mockResolvedValue(null);
  prisma.vacancy.findMany.mockResolvedValue([]);
  prisma.staffUser.findMany.mockResolvedValue([]);
  const { items } = await inbox.forStaff({ user: { id: 7, type: 'staff', role: 'HR_Officer' } });
  expect(items.find((i) => i.key === 'employment-checks')).toBeUndefined();
  expect(prisma.internalProfile.findMany).not.toHaveBeenCalled();

  await expect(reminders.run(new Date('2026-11-10T07:00:00Z'))).resolves.toMatch(/skipped/);
  expect(prisma.internalProfile.updateMany).not.toHaveBeenCalled();
});

test('production proper (the nginx site stamp) ignores it and refuses to start; UAT only warns', () => {
  const prod = { NODE_ENV: 'production', REQUIRE_SITE_HEADER: 'true', EMPLOYMENT_CHECK_REQUIRED: 'false' };
  expect(productionProblems(prod).problems).toContainEqual(expect.stringContaining('EMPLOYMENT_CHECK_REQUIRED=false'));
  const uat = { NODE_ENV: 'production', EMPLOYMENT_CHECK_REQUIRED: 'false' };
  expect(productionProblems(uat).problems).not.toContainEqual(expect.stringContaining('EMPLOYMENT_CHECK_REQUIRED'));
  expect(productionProblems(uat).warnings).toContainEqual(expect.stringContaining('switched off'));

  process.env.REQUIRE_SITE_HEADER = 'true';
  try {
    expect(employmentCheckRequired()).toBe(true);
  } finally {
    delete process.env.REQUIRE_SITE_HEADER;
  }
});
