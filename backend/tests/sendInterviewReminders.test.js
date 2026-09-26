jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const { run } = require('../scripts/sendInterviewReminders');

function round(id, overrides = {}) {
  return {
    id, roundNumber: 1, status: 'Scheduled', scheduledDate: new Date(Date.now() + 12 * 3600000), durationMinutes: 30,
    mode: 'In-person', location: 'Room B', rescheduleCount: 0, scheduledById: 9, instructions: null,
    application: {
      candidateId: 100 + id, candidate: { fullName: `Candidate ${id}` },
      vacancy: { jobRef: 'R1', title: 'ATC', createdById: 2 }
    },
    panelMembers: [{ id: 1, name: 'Ann', email: 'ann@example.test', score: null }],
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.candidate.findUnique.mockResolvedValue({ email: 'c@example.test' });
  prisma.staffUser.findUnique.mockResolvedValue({ id: 9, email: null });
});

test('reminds each candidate, sends each panelist one email, and marks the rounds reminded', async () => {
  prisma.interviewRound.findMany
    .mockResolvedValueOnce([round(1), round(2)]) // due for reminder
    .mockResolvedValueOnce([]); // overdue for scores

  const summary = await run();

  const reminders = prisma.candidateNotification.create.mock.calls.map((c) => c[0].data).filter((d) => d.channel === 'InApp');
  expect(reminders.map((d) => [d.candidateId, d.type])).toEqual([[101, 'InterviewReminder'], [102, 'InterviewReminder']]);
  expect(sendMail.mock.calls.filter((c) => c[0].to === 'ann@example.test')).toHaveLength(1);
  expect(prisma.interviewRound.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { reminderSentAt: expect.any(Date) } });
  expect(prisma.interviewRound.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { reminderSentAt: expect.any(Date) } });
  expect(summary).toMatch(/2 candidate reminder/);
});

test('groups overdue rounds into one notice per scheduler per kind', async () => {
  const past = new Date(Date.now() - 48 * 3600000);
  prisma.interviewRound.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      round(1, { scheduledDate: past }), // missing scores
      round(2, { scheduledDate: past }), // missing scores
      round(3, { scheduledDate: past, panelMembers: [{ id: 2, score: 80 }] }) // complete
    ]);

  await run();

  const inApp = prisma.notification.create.mock.calls.map((c) => c[0].data).filter((d) => d.channel === 'InApp');
  expect(inApp.map((d) => d.taskType).sort()).toEqual(['InterviewReadyToFinalize', 'InterviewScoresOverdue']);
  expect(inApp.find((d) => d.taskType === 'InterviewScoresOverdue').message).toMatch(/2 interviews/);
  for (const id of [1, 2, 3]) {
    expect(prisma.interviewRound.update).toHaveBeenCalledWith({ where: { id }, data: { scoreNudgeSentAt: expect.any(Date) } });
  }
});
