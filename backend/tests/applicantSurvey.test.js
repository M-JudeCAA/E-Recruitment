jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const controller = require('../src/controllers/feedbackController');
const surveys = require('../src/services/applicantSurveyService');

function mockRes() {
  const res = { locals: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

const internal = { id: 7, type: 'candidate', candidateType: 'Internal' };
const answers = { applicationId: 31, overallRating: 4, easeRating: 5, clarityRating: 3, timeTaken: '15to30', hadProblems: true, problems: ' Upload was slow ', suggestions: '' };

beforeEach(() => jest.clearAllMocks());

describe('answering the survey', () => {
  test('an internal candidate gives feedback on their own submitted application', async () => {
    prisma.application.findFirst.mockResolvedValue({ id: 31, status: 'Submitted', vacancy: { title: 'ICT Officer', jobRef: 'UCAA/ADV/INT/001/2026' } });
    prisma.applicantSurvey.create.mockResolvedValue({ id: 1, submittedAt: new Date() });
    const res = mockRes();

    await controller.submit({ user: internal, body: answers }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.application.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 31, candidateId: 7 } }));
    expect(prisma.applicantSurvey.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      candidateId: 7, applicationId: 31, vacancyTitle: 'ICT Officer', jobRef: 'UCAA/ADV/INT/001/2026',
      overallRating: 4, easeRating: 5, clarityRating: 3, timeTaken: '15to30', hadProblems: true, problems: 'Upload was slow', suggestions: null
    }));
  });

  test('an external candidate is refused', async () => {
    const res = mockRes();
    await controller.submit({ user: { ...internal, candidateType: 'External' }, body: answers }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SURVEY_INTERNAL_ONLY' }));
    expect(prisma.applicantSurvey.create).not.toHaveBeenCalled();
  });

  test('a draft, or someone else\'s application, is not found', async () => {
    prisma.application.findFirst.mockResolvedValueOnce({ id: 31, status: 'Draft', vacancy: {} }).mockResolvedValueOnce(null);
    for (let i = 0; i < 2; i++) {
      const res = mockRes();
      await controller.submit({ user: internal, body: answers }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(prisma.applicantSurvey.create).not.toHaveBeenCalled();
  });

  test('a second answer for the same application is refused', async () => {
    prisma.application.findFirst.mockResolvedValue({ id: 31, status: 'Submitted', vacancy: { title: 'X' } });
    prisma.applicantSurvey.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const res = mockRes();
    await controller.submit({ user: internal, body: answers }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SURVEY_ALREADY_ANSWERED' }));
  });

  test('every rating must be 1 to 5; problems are kept only when they had some', () => {
    expect(() => surveys.parseAnswers({ ...answers, easeRating: 0 })).toThrow(/1 to 5/);
    expect(() => surveys.parseAnswers({ ...answers, clarityRating: undefined })).toThrow(/1 to 5/);
    expect(() => surveys.parseAnswers({ ...answers, timeTaken: 'ages' })).toThrow(/how long/);
    expect(surveys.parseAnswers({ ...answers, hadProblems: false }).problems).toBeNull();
  });

  test('status says whether this application was already answered', async () => {
    prisma.application.findFirst.mockResolvedValue({ id: 31, status: 'Submitted', vacancy: {} });
    prisma.applicantSurvey.findUnique.mockResolvedValue({ submittedAt: new Date('2026-10-28T09:00:00Z') });
    const res = mockRes();
    await controller.status({ user: internal, params: { applicationId: '31' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ answered: true }));
  });
});

describe('what HR and system administrators see', () => {
  const row = (id, overall, extra = {}) => ({
    id, candidateId: 99, applicationId: id, vacancyTitle: 'ICT Officer', jobRef: null, overallRating: overall, easeRating: 4, clarityRating: 2,
    timeTaken: 'under15', hadProblems: false, problems: null, suggestions: null, submittedAt: new Date('2026-10-28T09:00:00Z'), ...extra
  });

  test('responses come with a summary and without the candidate', async () => {
    prisma.applicantSurvey.findMany.mockResolvedValue([row(1, 5), row(2, 2, { hadProblems: true, problems: 'Lost my draft' })]);
    const res = mockRes();
    await controller.list({ user: { type: 'staff' }, query: { from: '2026-10-01', to: '2026-10-31' } }, res);

    const where = prisma.applicantSurvey.findMany.mock.calls[0][0].where;
    expect(where.submittedAt.gte).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(where.submittedAt.lt).toEqual(new Date('2026-11-01T00:00:00Z'));
    const body = res.json.mock.calls[0][0];
    expect(body.summary).toEqual(expect.objectContaining({ responses: 2, hadProblems: 1 }));
    expect(body.summary.averages).toEqual({ overallRating: 3.5, easeRating: 4, clarityRating: 2 });
    expect(body.summary.distribution.overallRating).toEqual([0, 1, 0, 0, 1]);
    expect(body.responses[0]).not.toHaveProperty('candidateId');
    expect(body.responses[0]).not.toHaveProperty('applicationId');
    expect(body.responses[1].problems).toBe('Lost my draft');
  });

  test('the export is a CSV and is audited', async () => {
    prisma.applicantSurvey.findMany.mockResolvedValue([row(1, 5, { suggestions: '=SUM(A1)' })]);
    const res = mockRes();
    await controller.exportCsv({ user: { id: 3, type: 'staff' }, query: {} }, res);
    const csv = res.send.mock.calls[0][0];
    expect(csv).toContain('Overall (1-5)');
    expect(csv).toContain("'=SUM(A1)");
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
