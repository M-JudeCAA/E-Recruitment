jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/services/conflictOfInterestService', () => ({ conflictedVacancyIds: jest.fn() }));
jest.mock('../src/services/accessLogService', () => ({ record: jest.fn() }));

const prisma = require('../src/config/db');
const conflictOfInterest = require('../src/services/conflictOfInterestService');
const accessLog = require('../src/services/accessLogService');
const talent = require('../src/controllers/talentController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  conflictOfInterest.conflictedVacancyIds.mockResolvedValue([]);
});

describe('GET /api/talent/candidates/:candidateId', () => {
  test('returns the profile, the latest application and their CV, and logs the view', async () => {
    prisma.candidate.findFirst.mockResolvedValue({
      id: 7, fullName: 'Jane Doe', education: [], workExperience: [],
      applications: [
        { id: 30, referees: [], vacancy: { id: 3, jobRef: 'R3', title: 'Pilot' }, documents: [] },
        { id: 20, referees: [], vacancy: { id: 2, jobRef: 'R2', title: 'Clerk' }, documents: [{ id: 5, fileUrl: '/api/files/cv.pdf', originalName: 'cv.pdf' }] }
      ]
    });
    const res = mockRes();
    await talent.profile({ params: { candidateId: '7' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.candidate).toEqual(expect.objectContaining({ id: 7, fullName: 'Jane Doe' }));
    expect(body.candidate.applications).toBeUndefined();
    expect(body.latestApplication).toEqual(expect.objectContaining({ id: 30 }));
    expect(body.latestApplication.documents).toBeUndefined();
    // The CV comes from the latest application that has one.
    expect(body.cv).toEqual({ id: 5, fileUrl: '/api/files/cv.pdf', originalName: 'cv.pdf', applicationId: 20 });
    expect(accessLog.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ candidateIds: [7] }));
  });

  test('leaves out a candidate who applied for a vacancy the viewer applied for', async () => {
    conflictOfInterest.conflictedVacancyIds.mockResolvedValue([4]);
    prisma.candidate.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await talent.profile({ params: { candidateId: '7' } }, res);

    expect(prisma.candidate.findFirst.mock.calls[0][0].where).toEqual(expect.objectContaining({
      purgedAt: null,
      NOT: { applications: { some: { vacancyId: { in: [4] }, status: { not: 'Draft' } } } }
    }));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(accessLog.record).not.toHaveBeenCalled();
  });

  test('refuses an id that is not a number', async () => {
    const res = mockRes();
    await talent.profile({ params: { candidateId: 'abc' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
