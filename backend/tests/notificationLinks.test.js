jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const { linkFor } = require('../src/utils/notificationLinks');

beforeEach(() => jest.clearAllMocks());

const params = (link) => Object.fromEntries(new URL(link, 'https://x').searchParams);

describe('linkFor', () => {
  test('an approval opens its review in the Inbox, falling back to where the work is', async () => {
    expect(params(await linkFor('VacancyApproval', 5))).toEqual({ item: 'vacancy-5-approveVacancy', fallback: '/hr/vacancy/5' });
    expect(params(await linkFor('MeritListProposed', 5))).toEqual({ item: 'vacancy-5-approveMerit', fallback: '/hr/vacancy/5?tab=merit' });
    expect(params(await linkFor('PositionApproval', 9))).toEqual({ item: 'position-9', fallback: '/hr/organisation/positions?open=9' });

    prisma.offer.findUnique.mockResolvedValue({ application: { vacancyId: 3 } });
    expect(params(await linkFor('OfferApproval', 12))).toEqual({ item: 'offer-12', fallback: '/hr/vacancy/3?tab=merit' });

    prisma.shortlistExercise.findUnique.mockResolvedValue({ vacancyId: 4 });
    expect(params(await linkFor('CommitteeNominationSubmitted', 2))).toEqual({ item: 'vacancy-4-approveCommittee', fallback: '/hr/vacancy/4?tab=committee' });
  });

  test('other notices open where the work is', async () => {
    prisma.application.findUnique.mockResolvedValue({ vacancyId: 6 });
    expect(await linkFor('NewApplicationSubmitted', 30)).toBe('/hr/vacancy/6?tab=applicants');
    expect(await linkFor('InterviewRescheduleRequested', 8)).toBe('/hr/interviews?round=8');
    expect(await linkFor('VacancyReturned', 5)).toBe('/hr/vacancy/5');
    expect(await linkFor('SystemHealthAlert', 0)).toBe('/hr/inbox');
    expect(await linkFor('PendingApprovalsDigest', 0)).toBe('/hr/inbox');
  });

  test('a lookup that fails still gives somewhere to go', async () => {
    prisma.offer.findUnique.mockRejectedValue(new Error('gone'));
    expect(await linkFor('OfferDeclined', 1)).toBe('/hr');
  });
});
