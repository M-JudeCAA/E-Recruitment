jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const applicationController = require('../src/controllers/applicationController');
// submit() lives here, not in applicationController.js - it was split out
// (see applicationDraftController.js's own comment: "REPLACES the old
// single-step submit() entirely") when the draft/submit/withdraw workflow
// was introduced. This block below was left pointed at the wrong module
// and testing the shape of the retired single-step function (a direct
// req.body.vacancyId lookup) rather than the real one (req.params.id,
// application-first), so every case in it was failing before a single
// assertion ever ran.
const applicationDraftController = require('../src/controllers/applicationDraftController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('saveDraft', () => {
  test('blocks starting a brand new draft for a vacancy whose deadline has passed', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({
      id: 10, postingType: 'External', status: 'Open', deadline: new Date('2000-01-01'), desirableRequirements: []
    });
    prisma.application.findFirst.mockResolvedValue(null);
    const req = { body: { vacancyId: '10' }, files: {}, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  // CHANGED - continuing/editing an already-existing draft past the
  // deadline is now ALSO blocked, not just starting a new one. The Draft
  // row itself is untouched by this (still visible on My Applications) -
  // only this save endpoint refuses to update it further.
  test('also blocks updating an already-existing draft past the deadline', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({
      id: 10, postingType: 'External', status: 'Open', deadline: new Date('2000-01-01'), desirableRequirements: []
    });
    prisma.application.findFirst.mockResolvedValue({ id: 1, status: 'Draft' });
    const req = { body: { vacancyId: '10' }, files: {}, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.saveDraft(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });
});

describe('submit', () => {
  const completeReferees = [
    { name: 'A Referee', phone: '0700000001', email: 'a@example.com' },
    { name: 'B Referee', phone: '0700000002', email: 'b@example.com' },
    { name: 'C Referee', phone: '0700000003', email: 'c@example.com' }
  ];

  test('returns 404 when the application does not exist', async () => {
    prisma.application.findUnique.mockResolvedValue(null);
    const req = { params: { id: '99' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('returns 403 when the application does not belong to the candidate', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 99, vacancyId: 10, status: 'Draft', referees: completeReferees
    });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('returns 422 when the application is not a Draft (e.g. already submitted)', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Submitted', referees: completeReferees
    });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('returns 400 when fewer than three complete referees have been given', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Draft',
      referees: [completeReferees[0], completeReferees[1]]
    });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('returns 422 when the vacancy is Closed', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees: completeReferees
    });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 10, status: 'Closed', postingType: 'External', deadline: null });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('returns 422 when the vacancy is Filled', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees: completeReferees
    });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 10, status: 'Filled', postingType: 'External', deadline: null });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('returns 422 when the application deadline has passed', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees: completeReferees
    });
    prisma.vacancy.findUnique.mockResolvedValue({
      id: 10, status: 'Open', postingType: 'External', deadline: new Date('2000-01-01')
    });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  // Checked after vacancy eligibility (see the two Closed/Filled/deadline
  // cases above) so a candidate applying to an already-unavailable vacancy
  // gets that reason, not an unrelated "complete your profile" one.
  test('returns 422 when the candidate profile is incomplete', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees: completeReferees
    });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 10, status: 'Open', postingType: 'External', deadline: null });
    prisma.candidate.findUnique.mockResolvedValue({
      id: 5, candidateType: 'External', location: null, workAuthorization: null, nationalId: null,
      education: [], workExperience: []
    });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  // The updateMany-with-status-guard in applicationModel.updateIfStatus is
  // what makes this atomic - a second submit call for the same application
  // (double click reaching the API, a retry, two open tabs) matches zero
  // rows once the first has already flipped the status, instead of both
  // proceeding to capture a snapshot and notify the supervisor.
  test('returns 409 when a concurrent request already submitted this application', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees: completeReferees
    });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 10, status: 'Open', postingType: 'External', deadline: null });
    prisma.candidate.findUnique.mockResolvedValue({
      id: 5, candidateType: 'External', location: 'Kampala', workAuthorization: 'Yes', nationalId: 'A1234567',
      education: [{ id: 1 }], workExperience: [{ id: 1 }]
    });
    prisma.application.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(prisma.application.updateMany).toHaveBeenCalledWith({ where: { id: 1, status: 'Draft' }, data: expect.any(Object) });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  // Closes the two notification gaps found in the workflow audit: the
  // candidate gets a real confirmation (SubmitStep.jsx had promised one
  // for a while with nothing behind it), and the vacancy's creator (HR)
  // gets told a new application exists - previously true only for
  // Internal candidates, via the separate, unrelated notifySupervisor.
  test('notifies both the candidate (confirmation) and the vacancy creator (new application) on a successful submit', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees: completeReferees,
      // notifySupervisor (workflowService) re-fetches this same application
      // with its own include shape - the mock is include-agnostic, so this
      // needs candidate present too, not just for the top-of-submit read.
      candidate: { candidateType: 'External', internalProfile: null }
    });
    prisma.vacancy.findUnique.mockResolvedValue({
      id: 10, status: 'Open', postingType: 'External', deadline: null, createdById: 42,
      title: 'Air Traffic Controller', jobRef: 'UCAA/1', reviewStartedAt: null
    });
    prisma.candidate.findUnique.mockResolvedValue({
      id: 5, email: 'jane@example.com', fullName: 'Jane Doe', candidateType: 'External',
      location: 'Kampala', workAuthorization: 'Yes', nationalId: 'A1234567',
      education: [{ id: 1 }], workExperience: [{ id: 1 }]
    });
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.workExperience.findMany.mockResolvedValue([]);
    prisma.education.findMany.mockResolvedValue([]);
    const req = { params: { id: '1' }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'ApplicationSubmitted' })
    }));
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recipientId: 42, taskType: 'NewApplicationSubmitted', taskId: 1 })
    }));
    expect(res.json).toHaveBeenCalled();
  });
});

describe('count', () => {
  test('returns the total application count in one query', async () => {
    prisma.application.count.mockResolvedValue(42);
    const req = {};
    const res = mockRes();

    await applicationController.count(req, res);

    expect(prisma.application.count).toHaveBeenCalledWith({ where: { status: { not: 'Draft' } } });
    expect(res.json).toHaveBeenCalledWith({ count: 42 });
  });
});

describe('list', () => {
  test('rejects an invalid status filter', async () => {
    const req = { query: { status: 'NotARealStatus' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });

  test('rejects an invalid candidateType filter', async () => {
    const req = { query: { candidateType: 'Alien' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });

  test('rejects a non-numeric vacancyId filter', async () => {
    const req = { query: { vacancyId: 'abc' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });

  test('rejects a non-numeric departmentId filter', async () => {
    const req = { query: { departmentId: 'abc' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });

  test('defaults to excluding Draft, page 1, and a limit of 20', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    prisma.application.count.mockResolvedValue(0);
    const req = { query: {} };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { not: 'Draft' } }, skip: 0, take: 20
    }));
    expect(prisma.application.count).toHaveBeenCalledWith({ where: { status: { not: 'Draft' } } });
    expect(res.json).toHaveBeenCalledWith({ data: [], total: 0, page: 1, limit: 20 });
  });

  test('clamps an oversized limit to 100', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    prisma.application.count.mockResolvedValue(0);
    const req = { query: { limit: '500' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 100 }));
  });

  test('computes skip from page and limit together', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    prisma.application.count.mockResolvedValue(0);
    const req = { query: { page: '3', limit: '10' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ page: 3, limit: 10 }));
  });

  test('passes vacancyId, status, departmentId, candidateType, screeningPassed, and search through to the where clause', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    prisma.application.count.mockResolvedValue(0);
    const req = {
      query: {
        vacancyId: '10', status: 'UnderReview', departmentId: '4',
        candidateType: 'Internal', screeningPassed: 'false', search: ' jane '
      }
    };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'UnderReview',
        vacancyId: 10,
        vacancy: { departmentId: 4 },
        candidate: { candidateType: 'Internal', OR: [{ fullName: { contains: 'jane' } }, { email: { contains: 'jane' } }] },
        screeningPassed: false
      }
    }));
  });

  test('rejects an invalid sort', async () => {
    const req = { query: { sort: 'shuffle' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });

  test('passes a valid sort through to the orderBy clause', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    prisma.application.count.mockResolvedValue(0);
    const req = { query: { sort: 'score' } };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { shortlistScore: 'desc' }
    }));
  });

  test('defaults to newest-first when no sort is given', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    prisma.application.count.mockResolvedValue(0);
    const req = { query: {} };
    const res = mockRes();

    await applicationController.list(req, res);

    expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { submittedDate: 'desc' }
    }));
  });

  describe('needsAction', () => {
    test('a Senior HR Officer only sees Submitted/UnderReview', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);
      const req = { query: { needsAction: 'true' }, user: { role: 'Senior_HR_Officer' } };
      const res = mockRes();

      await applicationController.list(req, res);

      expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ OR: [{ status: { in: ['Submitted', 'UnderReview'] } }] })
      }));
    });

    test('a Manager sees the union of every lower tier\'s actionable statuses plus offers pending their approval', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);
      const req = { query: { needsAction: 'true' }, user: { role: 'Manager' } };
      const res = mockRes();

      await applicationController.list(req, res);

      expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { status: { in: ['Submitted', 'UnderReview'] } },
            { status: 'Interviewed', offer: null },
            { offer: { status: 'Recommended' } }
          ]
        })
      }));
    });

    test('an HR Officer, with no direct decision power in this queue, falls back to flagged applications', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);
      const req = { query: { needsAction: 'true' }, user: { role: 'HR_Officer' } };
      const res = mockRes();

      await applicationController.list(req, res);

      expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ OR: [{ screeningPassed: false }] })
      }));
    });

    test('ignores the plain status/screeningPassed filters while active', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);
      const req = {
        query: { needsAction: 'true', status: 'Rejected', screeningPassed: 'true' },
        user: { role: 'Principal_HR_Officer' }
      };
      const res = mockRes();

      await applicationController.list(req, res);

      expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          status: 'Rejected',
          OR: [
            { status: { in: ['Submitted', 'UnderReview'] } },
            { status: 'Interviewed', offer: null }
          ]
        }
      }));
    });
  });
});

describe('recommendOffer', () => {
  test('rejects when the application has no scored interview yet', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1,
      interviewRounds: [{ id: 1, score: null, recommendation: null }]
    });
    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('rejects when a score exists but no recommendation has been finalized yet', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1,
      interviewRounds: [{ id: 1, score: 82, recommendation: null }]
    });
    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('rejects when the application is not at Interviewed (e.g. already Rejected by a panel "Reject" recommendation)', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, status: 'Rejected',
      interviewRounds: [{ id: 1, score: 78, recommendation: 'Reject' }]
    });
    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('rejects a "Hold" or "Reject" recommendation even if the application status is Interviewed', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, status: 'Interviewed',
      interviewRounds: [{ id: 1, score: 78, recommendation: 'Hold' }]
    });
    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  // A candidate can have multiple rounds - only the MOST RECENT one's
  // recommendation should count. An earlier round saying Shortlist must not
  // still qualify once a later round has said otherwise.
  test('rejects when an earlier round said Shortlist but the most recent round did not', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, status: 'Interviewed',
      interviewRounds: [
        { id: 1, roundNumber: 1, score: 90, recommendation: 'Shortlist' },
        { id: 2, roundNumber: 2, score: 40, recommendation: 'Hold' }
      ]
    });
    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  test('accepts when the most recent round says Shortlist, regardless of an earlier round', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, status: 'Interviewed',
      interviewRounds: [
        { id: 1, roundNumber: 1, score: 40, recommendation: 'Hold' },
        { id: 2, roundNumber: 2, score: 90, recommendation: 'Shortlist' }
      ]
    });
    prisma.offer.create.mockResolvedValue({ id: 11, applicationId: 1, status: 'Recommended' });
    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(prisma.offer.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('creates a Recommended offer and moves the application to Offered once a recommendation is finalized', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, status: 'Interviewed',
      interviewRounds: [{ id: 1, score: 78, recommendation: 'Shortlist' }]
    });
    prisma.offer.create.mockResolvedValue({ id: 10, applicationId: 1, status: 'Recommended' });

    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(prisma.offer.create).toHaveBeenCalledWith({
      data: { applicationId: 1, status: 'Recommended', recommendedById: 5, recommendedDate: expect.any(Date) }
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { status: 'Offered' }
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('returns 409 rather than a duplicate offer if one was already recommended', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, status: 'Interviewed',
      interviewRounds: [{ id: 1, score: 78, recommendation: 'Shortlist' }]
    });
    prisma.offer.create.mockRejectedValue(new Error('Unique constraint failed'));

    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('listOffersPendingApproval', () => {
  test('returns a paginated page of what the model finds', async () => {
    const offers = [{ id: 1, status: 'Recommended' }, { id: 2, status: 'Recommended' }];
    prisma.offer.findMany.mockResolvedValue(offers);
    prisma.offer.count.mockResolvedValue(2);
    const req = { query: {} };
    const res = mockRes();

    await applicationController.listOffersPendingApproval(req, res);

    expect(prisma.offer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'Recommended' }, skip: 0, take: 20
    }));
    expect(res.json).toHaveBeenCalledWith({ data: offers, total: 2, page: 1, limit: 20 });
  });
});

describe('approveOffer', () => {
  test('returns 404 rather than crashing when the offer does not exist', async () => {
    prisma.offer.findUnique.mockResolvedValue(null);
    const req = { params: { offerId: '999' }, user: { id: 2 } };
    const res = mockRes();

    await applicationController.approveOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  test('refuses to approve an offer that is not at Recommended', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await applicationController.approveOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  test('blocks the Manager who recommended the offer from approving it themselves', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Recommended', recommendedById: 2, application: { candidateId: 7, vacancyId: 3 }
    });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await applicationController.approveOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/Self-approval blocked/) });
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
  });

  test('returns 409 when a concurrent request already changed this offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 20, status: 'Recommended', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await applicationController.approveOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('approves an existing offer and notifies the candidate they can now act on it', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Recommended', recommendedById: 5, application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({
        id: 20, status: 'Approved',
        application: { candidateId: 7, vacancyId: 3, vacancy: { title: 'Air Traffic Controller' } }
      });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'candidate@example.com' });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await applicationController.approveOffer(req, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Recommended' },
      data: expect.objectContaining({ status: 'Approved', approvedById: 2 })
    });
    expect(res.json).toHaveBeenCalled();
    // Approving is a resolution - any active OfferApproval escalation for
    // this offer should clear, not sit "active" forever.
    expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith({
      where: { taskType: 'OfferApproval', taskId: 20, resolvedAt: null },
      data: { resolvedAt: expect.any(Date) }
    });
    // Approved is the moment the candidate can actually accept/decline -
    // this is the notification that tells them an offer exists at all.
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 7, type: 'OfferReceived' })
    }));
  });
});

describe('reject', () => {
  test('returns 404 when the application does not exist', async () => {
    prisma.application.findUnique.mockResolvedValue(null);
    const req = { params: { id: '99' }, body: {}, user: { id: 3 } };
    const res = mockRes();

    await applicationController.reject(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test.each(['Draft', 'Offered', 'Rejected', 'Withdrawn'])('refuses to reject an application at status %s', async (status) => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, status, vacancy: { title: 'Role' } });
    const req = { params: { id: '1' }, body: {}, user: { id: 3 } };
    const res = mockRes();

    await applicationController.reject(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test('rejects a Submitted/UnderReview/Shortlisted/Interviewed application, records who and why, and notifies the candidate', async () => {
    prisma.application.findUnique
      .mockResolvedValueOnce({ id: 1, status: 'UnderReview', candidateId: 7, vacancy: { title: 'Role' } })
      .mockResolvedValueOnce({ id: 1, status: 'Rejected', candidateId: 7, vacancy: { title: 'Role' }, rejectedBy: { name: 'Alice HR' } });
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'candidate@example.com' });
    const req = { params: { id: '1' }, body: { reason: 'Did not meet minimum experience.' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.reject(req, res);

    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'UnderReview' },
      data: expect.objectContaining({
        status: 'Rejected', rejectedById: 3, rejectionReason: 'Did not meet minimum experience.'
      })
    });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 7, type: 'ApplicationRejected' })
    }));
    expect(res.json).toHaveBeenCalled();
  });

  test('returns 409 when the application changed status before this could apply', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'Submitted', candidateId: 7, vacancy: { title: 'Role' } });
    prisma.application.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { id: '1' }, body: {}, user: { id: 3 } };
    const res = mockRes();

    await applicationController.reject(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('shortlist', () => {
  test('rejects a non-integer rank', async () => {
    const req = { params: { id: '1' }, body: { rank: 'first' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.shortlist(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test('rejects an invalid listStatus', async () => {
    const req = { params: { id: '1' }, body: { listStatus: 'Maybe' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.shortlist(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test.each(['Draft', 'Offered', 'Rejected', 'Withdrawn'])('refuses to shortlist an application at status %s', async (status) => {
    const workflow = require('../src/services/workflowService');
    jest.spyOn(workflow, 'assertCanShortlist').mockResolvedValue(undefined);
    prisma.application.findUnique.mockResolvedValue({ id: 1, status, vacancy: { title: 'Role' } });
    const req = { params: { id: '1' }, body: { rank: 1, listStatus: 'Primary' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.shortlist(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test('returns 409 when a concurrent request already changed this application', async () => {
    const workflow = require('../src/services/workflowService');
    jest.spyOn(workflow, 'assertCanShortlist').mockResolvedValue(undefined);
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'UnderReview', vacancy: { title: 'Role' } });
    prisma.application.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { id: '1' }, body: { rank: 1, listStatus: 'Primary' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.shortlist(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  // shortlist() only ever proposes - it lands at ShortlistProposed, stamped
  // with who proposed it and when, and does NOT notify the candidate. Only
  // approveShortlist (below) makes it effective and notifies.
  test('proposes the shortlist (ShortlistProposed, not Shortlisted) without notifying the candidate', async () => {
    const workflow = require('../src/services/workflowService');
    jest.spyOn(workflow, 'assertCanShortlist').mockResolvedValue(undefined);
    prisma.application.findUnique
      .mockResolvedValueOnce({ id: 1, status: 'UnderReview', candidateId: 7, vacancy: { title: 'Role' } })
      .mockResolvedValueOnce({ id: 1, status: 'ShortlistProposed', candidateId: 7, vacancy: { title: 'Role' } });
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    const req = { params: { id: '1' }, body: { rank: 1, listStatus: 'Primary' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.shortlist(req, res);

    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'UnderReview' },
      data: {
        status: 'ShortlistProposed', rank: 1, listStatus: 'Primary', rankVersion: { increment: 1 },
        shortlistProposedAt: expect.any(Date), shortlistProposedById: 3
      }
    });
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});

describe('approveShortlist', () => {
  const workflow = require('../src/services/workflowService');

  test('rejects an invalid vacancy id', async () => {
    const req = { params: { vacancyId: 'abc' }, user: { id: 3 } };
    const res = mockRes();
    await applicationController.approveShortlist(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('refuses when no proposed shortlist is awaiting approval', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    const req = { params: { vacancyId: '5' }, user: { id: 3 } };
    const res = mockRes();
    await applicationController.approveShortlist(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test('blocks self-approval when the approver proposed one of the applications', async () => {
    prisma.application.findMany.mockResolvedValue([{ id: 1, candidateId: 7, shortlistProposedById: 3 }]);
    const req = { params: { vacancyId: '5' }, user: { id: 3 } };
    const res = mockRes();
    await applicationController.approveShortlist(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test('approves every ShortlistProposed application for the vacancy in one batch and notifies each candidate', async () => {
    jest.spyOn(workflow, 'assertNotSelfApprovedShortlist').mockResolvedValue(undefined);
    prisma.application.findMany.mockResolvedValue([
      { id: 1, candidateId: 7, shortlistProposedById: 9 },
      { id: 2, candidateId: 8, shortlistProposedById: 9 }
    ]);
    prisma.application.updateMany.mockResolvedValue({ count: 2 });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 5, title: 'Role' });
    const req = { params: { vacancyId: '5' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.approveShortlist(req, res);

    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { vacancyId: 5, status: 'ShortlistProposed' },
      data: { status: 'Shortlisted', shortlistApprovedAt: expect.any(Date), shortlistApprovedById: 3 }
    });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 7, type: 'ApplicationShortlisted' })
    }));
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 8, type: 'ApplicationShortlisted' })
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ vacancyId: 5, approvedCount: 2 }));
  });
});

describe('acceptOffer / declineOffer ownership check', () => {
  test('acceptOffer rejects a candidate who does not own the offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, application: { candidateId: 99, vacancyId: 3 }
    });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.acceptOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  test('acceptOffer refuses an offer that is not Approved', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Recommended', application: { candidateId: 7, vacancyId: 3 }
    });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.acceptOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  test('acceptOffer returns 409 when a concurrent request already changed this offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(0);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.acceptOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('acceptOffer refuses with 409 once every position on the vacancy is already filled', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(1);
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.acceptOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/already been filled/) });
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('acceptOffer tells Principal HR Officers when an acceptance is refused because the vacancy is full', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, status: 'Approved', applicationId: 44,
      application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3, jobRef: 'UCAA/ADV/EXT/09/2026', title: 'Pilot' } }
    });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValue(1);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: 'phro@caa.co.ug' });
    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.acceptOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.staffUser.findMany).toHaveBeenCalledWith({ where: { role: 'Principal_HR_Officer' }, select: { id: true } });
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recipientId: 30, channel: 'InApp', taskType: 'VacancyFilledWithOpenOffers', taskId: 20,
      message: expect.stringMatching(/UCAA\/ADV\/EXT\/09\/2026 \(Pilot\) \(application #44\).*every position is already filled/)
    }) });
  });

  test('acceptOffer flags the other open offers to HR when this acceptance fills the vacancy', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({ id: 20, status: 'Accepted', application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3 } } });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique
      .mockResolvedValueOnce({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null }) // recompute, inside the transaction
      .mockResolvedValueOnce({ id: 3, status: 'Filled', jobRef: 'UCAA/ADV/EXT/09/2026', title: 'Pilot' }); // after commit
    prisma.offer.findMany.mockResolvedValue([
      { id: 21, applicationId: 60, status: 'Approved', application: { candidate: { fullName: 'Grace A.' } } },
      { id: 22, applicationId: 61, status: 'Recommended', application: { candidate: { fullName: 'John B.' } } }
    ]);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: null });
    const res = mockRes();

    await applicationController.acceptOffer({ params: { offerId: '20' }, user: { id: 7 } }, res);

    expect(prisma.offer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['Recommended', 'Approved'] }, application: { vacancyId: 3 }, id: { not: 20 } }
    }));
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      taskType: 'VacancyFilledWithOpenOffers', taskId: 3,
      message: expect.stringMatching(/is now filled, but 2 other offers are still open: Grace A\. \(application #60, offer Approved\); John B\. \(application #61, offer Recommended\)/)
    }) });
    expect(res.json.mock.calls[0][0].id).toBe(20);
  });

  test('acceptOffer sends no open-offer notice when the vacancy still has positions left', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({ id: 20, status: 'Accepted', application: { candidateId: 7, vacancyId: 3, vacancy: { id: 3 } } });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 2 }]);
    prisma.offer.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique
      .mockResolvedValueOnce({ id: 3, positionsRequired: 2, status: 'Open', filledAt: null })
      .mockResolvedValueOnce({ id: 3, status: 'PartiallyFilled' });

    await applicationController.acceptOffer({ params: { offerId: '20' }, user: { id: 7 } }, mockRes());

    expect(prisma.offer.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('acceptOffer succeeds for the actual owning candidate', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 20, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({
        id: 20, status: 'Accepted', approvedById: 2,
        application: { candidateId: 7, vacancyId: 3, vacancy: { positionsRequired: 1, internalSalaryRange: '10-12M', recruiterNotes: 'x' } }
      });
    prisma.$queryRaw.mockResolvedValue([{ positionsRequired: 1 }]);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count
      .mockResolvedValueOnce(0) // capacity check under the lock
      .mockResolvedValueOnce(1); // recompute after the flip

    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.acceptOffer(req, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Approved' }, data: { status: 'Accepted', decidedAt: expect.any(Date) }
    });
    // The vacancy fills up (1 accepted of 1 required) - recomputeVacancyStatus
    // ran as part of the same transaction as the offer flip.
    expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'Filled', filledAt: expect.any(Date) } });
    const body = res.json.mock.calls[0][0];
    expect(body.id).toBe(20);
    expect(body.application.vacancy.positionsRequired).toBe(1);
    expect(body.application.vacancy.internalSalaryRange).toBeUndefined();
    expect(body.application.vacancy.recruiterNotes).toBeUndefined();
  });

  test('declineOffer rejects a candidate who does not own the offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 21, application: { candidateId: 99, vacancyId: 3 }
    });
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.declineOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('declineOffer refuses an offer that is not Approved', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 }
    });
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.declineOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('declineOffer returns 409 when a concurrent request already changed this offer', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 21, status: 'Approved', application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.declineOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('declineOffer never returns the promoted reserve candidate\'s application to the decliner', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', application: { candidateId: 7, vacancyId: 3 } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue({ id: 55, candidateId: 8, vacancyId: 3, listStatus: 'Reserve', whyThisRole: 'private answer' });
    prisma.application.update.mockResolvedValue({});
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    const req = { params: { offerId: '21' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.declineOffer(req, res);

    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { listStatus: 'Primary' } });
    expect(res.json).toHaveBeenCalledWith({ message: 'Offer declined' });
  });

  test('declineOffer tells Principal HR Officers which reserve candidate was promoted', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', applicationId: 50, application: { candidateId: 7, vacancyId: 3, vacancy: { jobRef: 'UCAA/ADV/INT/09/2026', title: 'Engineer' } } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue({ id: 55, listStatus: 'Reserve' });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }, { id: 31 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: 'phro@caa.co.ug' });

    await applicationController.declineOffer({ params: { offerId: '21' }, user: { id: 7 } }, mockRes());

    const inApp = prisma.notification.create.mock.calls.map((c) => c[0].data).filter((d) => d.channel === 'InApp');
    expect(inApp.map((d) => d.recipientId)).toEqual([30, 31]);
    expect(inApp[0]).toEqual(expect.objectContaining({
      taskType: 'OfferDeclined', taskId: 21,
      message: expect.stringMatching(/UCAA\/ADV\/INT\/09\/2026 \(Engineer\) was declined \(application #50\)\. The next reserve candidate \(application #55\) has been moved to Primary/)
    }));
  });

  test('declineOffer tells HR when no reserve candidate is left', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', applicationId: 50, application: { candidateId: 7, vacancyId: 3, vacancy: { jobRef: 'R', title: 'T' } } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue(null);
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    prisma.staffUser.findMany.mockResolvedValue([{ id: 30 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 30, email: null });

    await applicationController.declineOffer({ params: { offerId: '21' }, user: { id: 7 } }, mockRes());

    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      taskType: 'OfferDeclined', message: expect.stringMatching(/no reserve candidates left/)
    }) });
  });

  test('declineOffer still succeeds when notifying HR fails', async () => {
    prisma.offer.findUnique
      .mockResolvedValueOnce({ id: 21, status: 'Approved', applicationId: 50, application: { candidateId: 7, vacancyId: 3, vacancy: { jobRef: 'R', title: 'T' } } })
      .mockResolvedValueOnce({ id: 21, status: 'Declined', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.findFirst.mockResolvedValue(null);
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open', filledAt: null });
    prisma.offer.count.mockResolvedValue(0);
    prisma.staffUser.findMany.mockRejectedValue(new Error('db blip'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();

    await applicationController.declineOffer({ params: { offerId: '21' }, user: { id: 7 } }, res);

    expect(res.json).toHaveBeenCalledWith({ message: 'Offer declined' });
    console.error.mockRestore();
  });
});

describe('withdrawOffer', () => {
  const approvedOffer = {
    id: 20, status: 'Approved', applicationId: 44,
    application: { candidateId: 7, vacancyId: 3, vacancy: { title: 'Pilot' } }
  };

  test('returns 404 for an offer that does not exist', async () => {
    prisma.offer.findUnique.mockResolvedValue(null);
    const res = mockRes();

    await applicationController.withdrawOffer({ params: { offerId: '999' }, body: {}, user: { id: 30 } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test.each(['Accepted', 'Declined', 'Withdrawn'])('refuses to withdraw an offer that is already %s', async (status) => {
    prisma.offer.findUnique.mockResolvedValue({ ...approvedOffer, status });
    const res = mockRes();

    await applicationController.withdrawOffer({ params: { offerId: '20' }, body: {}, user: { id: 30 } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  test('returns 409 when a concurrent action already changed the offer', async () => {
    prisma.offer.findUnique.mockResolvedValue(approvedOffer);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();

    await applicationController.withdrawOffer({ params: { offerId: '20' }, body: {}, user: { id: 30 } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('withdraws an Approved offer, audits who did it and why, and tells the candidate', async () => {
    prisma.offer.findUnique.mockResolvedValueOnce(approvedOffer).mockResolvedValueOnce({ ...approvedOffer, status: 'Withdrawn' });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'cand@example.com' });
    const res = mockRes();

    await applicationController.withdrawOffer({ params: { offerId: '20' }, body: { reason: 'Position <filled>' }, user: { id: 30 } }, res);

    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'Approved' }, data: { status: 'Withdrawn', decidedAt: expect.any(Date) }
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: {
      entityType: 'Offer', entityId: 20, action: 'Offer withdrawn', performedById: 30,
      payload: { previousStatus: 'Approved', reason: 'Position <filled>' }
    } });
    expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith({
      where: { taskType: 'OfferApproval', taskId: 20, resolvedAt: null }, data: { resolvedAt: expect.any(Date) }
    });
    // The reason goes into an HTML email body, so it is escaped.
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      candidateId: 7, type: 'OfferWithdrawn',
      message: expect.stringMatching(/Your offer for "Pilot" has been withdrawn\. Reason given: Position &lt;filled&gt;/)
    }) });
    expect(res.json.mock.calls[0][0].status).toBe('Withdrawn');
  });

  test('does not notify the candidate when withdrawing an offer they were never told about', async () => {
    const recommended = { ...approvedOffer, status: 'Recommended' };
    prisma.offer.findUnique.mockResolvedValueOnce(recommended).mockResolvedValueOnce({ ...recommended, status: 'Withdrawn' });
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });

    await applicationController.withdrawOffer({ params: { offerId: '20' }, body: {}, user: { id: 30 } }, mockRes());

    expect(prisma.offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 20, status: 'Recommended' } }));
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
  });
});
