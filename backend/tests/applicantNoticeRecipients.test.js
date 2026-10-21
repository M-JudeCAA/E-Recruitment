// A staff member who applied for a vacancy hears nothing about its other
// applicants - not even through the notices addressed to them as its
// creator or as whoever scheduled an interview. Those go to the Principal
// HR Officers instead (conflictOfInterestService.noticeRecipients).
jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) }));

const prisma = require('../src/config/db');
const { noticeRecipients } = require('../src/services/conflictOfInterestService');

const GILLIAN = 12; // created vacancy 2, then applied for it
const PHROS = [{ id: 30 }, { id: 31 }];

// Vacancy 2 has a staff applicant (Gillian); no other vacancy does.
function staffApplied({ phros = PHROS, managers = [{ id: 40 }] } = {}) {
  prisma.candidate.findMany.mockImplementation(async ({ where }) => (
    where.applications?.some?.vacancyId === 2 ? [{ email: 'gowakubariho@caa.co.ug', entraObjectId: null }] : []
  ));
  prisma.staffUser.findMany.mockImplementation(async ({ where }) => {
    if (where.OR) return [{ id: GILLIAN }];
    if (where.role === 'Principal_HR_Officer') return phros.filter((p) => !where.id.notIn.includes(p.id));
    if (where.role === 'Manager') return managers;
    return [];
  });
}

const sentTo = (taskType) => prisma.notification.create.mock.calls
  .map(([{ data }]) => data).filter((d) => d.taskType === taskType && d.channel === 'InApp');

beforeEach(() => {
  jest.clearAllMocks();
  staffApplied();
  prisma.notification.create.mockResolvedValue({});
  prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: 'phro@caa.co.ug' });
});

describe('noticeRecipients', () => {
  test('someone who has not applied gets their notice as before', async () => {
    await expect(noticeRecipients(7, [GILLIAN])).resolves.toEqual({ ids: [GILLIAN], redirected: false });
  });

  test("an applicant's notice goes to the Principal HR Officers instead", async () => {
    await expect(noticeRecipients(2, [GILLIAN])).resolves.toEqual({ ids: [30, 31], redirected: true });
  });

  test('a Principal HR Officer who applied is not among them', async () => {
    staffApplied({ phros: [{ id: GILLIAN }, { id: 31 }] });
    await expect(noticeRecipients(2, [GILLIAN])).resolves.toEqual({ ids: [31], redirected: true });
  });

  test('with no Principal HR Officers, the Managers', async () => {
    staffApplied({ phros: [] });
    await expect(noticeRecipients(2, [GILLIAN])).resolves.toEqual({ ids: [40], redirected: true });
  });
});

describe('the vacancy deadline notice', () => {
  const { run } = require('../scripts/checkVacancyDeadlines');

  test("goes to the Principal HR Officers, not the creator who applied - the count isn't hers to know", async () => {
    prisma.vacancy.findMany.mockResolvedValue([{
      id: 2, jobRef: 'UCAA/ADV/INT/002/2026', title: 'Assistant IT Help Desk Officer', createdById: GILLIAN,
      deadline: new Date(Date.now() - 3600000), reviewStartedAt: null
    }]);
    prisma.application.count.mockResolvedValue(4);
    prisma.vacancy.update.mockResolvedValue({});

    await run();

    const notices = sentTo('VacancyDeadlinePassed');
    expect(notices.map((d) => d.recipientId)).toEqual([30, 31]);
    expect(notices[0].message).toMatch(/created this vacancy has applied/);
  });
});

describe('the interview results reminder', () => {
  const { run } = require('../scripts/sendInterviewReminders');

  test('whoever scheduled the interview, having since applied, is not reminded - and not told the candidates', async () => {
    prisma.interviewRound.findMany
      .mockResolvedValueOnce([]) // nothing due for a candidate reminder
      .mockResolvedValueOnce([{
        id: 5, roundNumber: 1, status: 'Scheduled', scheduledDate: new Date(Date.now() - 2 * 86400000), scheduledById: GILLIAN,
        application: { candidate: { fullName: 'Rival Candidate' }, vacancy: { id: 2, jobRef: 'R2', title: 'Help Desk', createdById: GILLIAN } }
      }]);
    prisma.interviewRound.update.mockResolvedValue({});

    await run();

    const notices = sentTo('InterviewResultsOverdue');
    expect(notices.map((d) => d.recipientId)).toEqual([30, 31]);
    expect(notices.some((d) => d.recipientId === GILLIAN)).toBe(false);
  });
});

describe('a candidate asking to move their interview', () => {
  const { respond } = require('../src/controllers/candidateInterviewController');

  test('reaches the Principal HR Officers when whoever scheduled it has applied for the vacancy', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue({
      id: 5, roundNumber: 1, status: 'Scheduled', scheduledDate: new Date(Date.now() + 3 * 86400000), durationMinutes: 30,
      scheduledById: GILLIAN, applicationId: 9,
      application: { candidateId: 77, candidate: { fullName: 'Rival Candidate' }, vacancy: { id: 2, jobRef: 'R2', title: 'Help Desk', createdById: GILLIAN } }
    });
    prisma.interviewRound.update.mockResolvedValue({});
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await respond({ user: { type: 'candidate', id: 77 }, params: { id: '5' }, body: { response: 'RescheduleRequested', note: 'Mornings next week please' } }, res);

    expect(sentTo('InterviewRescheduleRequested').map((d) => d.recipientId)).toEqual([30, 31]);
  });
});
