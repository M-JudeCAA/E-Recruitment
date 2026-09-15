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
  test('returns whatever the model finds, unmodified', async () => {
    const offers = [{ id: 1, status: 'Recommended' }, { id: 2, status: 'Recommended' }];
    prisma.offer.findMany.mockResolvedValue(offers);
    const req = {};
    const res = mockRes();

    await applicationController.listOffersPendingApproval(req, res);

    expect(prisma.offer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'Recommended' }
    }));
    expect(res.json).toHaveBeenCalledWith(offers);
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

  test('approves an existing offer and notifies the candidate they can now act on it', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 20, status: 'Recommended', application: { candidateId: 7, vacancyId: 3 } });
    prisma.offer.update.mockResolvedValue({
      id: 20, status: 'Approved',
      application: { candidateId: 7, vacancyId: 3, vacancy: { title: 'Air Traffic Controller' } }
    });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'candidate@example.com' });
    const req = { params: { offerId: '20' }, user: { id: 2 } };
    const res = mockRes();

    await applicationController.approveOffer(req, res);

    expect(prisma.offer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 20 },
      data: expect.objectContaining({ status: 'Approved', approvedById: 2 })
    }));
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
  test('notifies the candidate once shortlisted', async () => {
    const workflow = require('../src/services/workflowService');
    jest.spyOn(workflow, 'assertCanShortlist').mockResolvedValue(undefined);
    prisma.application.update.mockResolvedValue({ id: 1, candidateId: 7, vacancy: { title: 'Role' } });
    prisma.candidate.findUnique.mockResolvedValue({ id: 7, email: 'candidate@example.com' });
    const req = { params: { id: '1' }, body: { rank: 1, listStatus: 'Primary' }, user: { id: 3 } };
    const res = mockRes();

    await applicationController.shortlist(req, res);

    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 7, type: 'ApplicationShortlisted' })
    }));
    expect(res.json).toHaveBeenCalled();
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

  test('acceptOffer succeeds for the actual owning candidate', async () => {
    prisma.offer.findUnique.mockResolvedValue({
      id: 20, application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.offer.update.mockResolvedValue({
      id: 20, approvedById: 2, application: { candidateId: 7, vacancyId: 3 }
    });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, positionsRequired: 1, status: 'Open' });
    prisma.offer.count.mockResolvedValue(1);

    const req = { params: { offerId: '20' }, user: { id: 7 } };
    const res = mockRes();

    await applicationController.acceptOffer(req, res);

    expect(prisma.offer.update).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
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
});
