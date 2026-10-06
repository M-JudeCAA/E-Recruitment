jest.mock('../src/config/db', () => require('./__mocks__/db'));
const { PRIVACY_NOTICE_VERSION } = require('../src/config/privacyNotice');
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
  prisma.applicationDocument.findMany.mockResolvedValue([{ category: 'Academic', evidenceKey: null }]);
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

  test('a vacancy id that is not a number is a bad request', async () => {
    const res = mockRes();
    await applicationDraftController.saveDraft({ body: { vacancyId: 'abc' }, files: {}, user: { id: 5, candidateType: 'External' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.findUnique).not.toHaveBeenCalled();
  });
});

describe('withdrawing a submitted application', () => {
  test('all HR staff are told - except anyone who applied for the vacancy themselves', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, vacancyId: 10, status: 'InterviewScheduled' });
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findMany.mockResolvedValue([]);
    prisma.vacancy.findUnique.mockResolvedValue({ id: 10, title: 'Air Traffic Controller', jobRef: 'UCAA/ADV/EXT/001/2026' });
    prisma.candidate.findUnique.mockResolvedValue({ id: 5, fullName: 'Jane <b>Doe</b>' });
    prisma.candidate.findMany.mockResolvedValue([{ email: 'okello@caa.co.ug', entraObjectId: 'oid-9' }]);
    prisma.staffUser.findMany
      .mockResolvedValueOnce([{ id: 3 }]) // staff who applied for the vacancy
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]); // everyone else in HR
    const res = mockRes();

    await applicationDraftController.withdraw({ params: { id: '1' }, body: { reason: 'Took another job' }, user: { id: 5 } }, res);

    expect(prisma.staffUser.findMany).toHaveBeenLastCalledWith({
      where: { role: { not: null }, active: true, id: { notIn: [3] } }, select: { id: true }
    });
    const notices = prisma.notification.create.mock.calls.map(([{ data }]) => data).filter((d) => d.channel === 'InApp');
    expect(notices.map((d) => d.recipientId).sort()).toEqual([1, 2]);
    expect(notices[0]).toEqual(expect.objectContaining({ taskType: 'ApplicationWithdrawn', taskId: 1 }));
    expect(notices[0].message).toBe('Jane &lt;b&gt;Doe&lt;/b&gt; withdrew their application for "Air Traffic Controller" (UCAA/ADV/EXT/001/2026) '
      + 'with an interview booked. Reason given: Took another job.');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  test('a notice that fails does not undo the withdrawal', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, vacancyId: 10, status: 'Submitted' });
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findMany.mockResolvedValue([]);
    prisma.vacancy.findUnique.mockRejectedValueOnce(new Error('db hiccup'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();

    await applicationDraftController.withdraw({ params: { id: '1' }, body: {}, user: { id: 5 } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    console.error.mockRestore();
  });
});

// Uploads nothing refers to any more are deleted, not left on disk.
describe('uploaded files no longer needed', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let dir;
  const upload = (name) => {
    fs.writeFileSync(path.join(dir, name), 'x');
    return { filename: name, originalname: name, path: path.join(dir, name) };
  };
  const exists = (name) => fs.existsSync(path.join(dir, name));
  const openVacancy = { id: 10, postingType: 'External', status: 'Open', deadline: null, desirableRequirements: [] };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erec-drafts-'));
    process.env.UPLOAD_DIR = dir;
  });
  afterEach(() => {
    delete process.env.UPLOAD_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a new cover letter replaces the old file', async () => {
    upload('old.pdf');
    const coverLetter = upload('new.pdf');
    prisma.vacancy.findUnique.mockResolvedValue(openVacancy);
    prisma.application.findFirst.mockResolvedValue({ id: 1, status: 'Draft', coverLetterUrl: '/api/files/old.pdf' });
    prisma.application.update.mockResolvedValue({ id: 1 });

    await applicationDraftController.saveDraft({ body: { vacancyId: '10' }, files: { coverLetter: [coverLetter] }, user: { id: 5, candidateType: 'External' } }, mockRes());

    expect(prisma.application.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ coverLetterUrl: '/api/files/new.pdf' }) }));
    expect(exists('old.pdf')).toBe(false);
    expect(exists('new.pdf')).toBe(true);
  });

  test('a refused draft save keeps nothing it uploaded', async () => {
    const coverLetter = upload('new.pdf');
    prisma.vacancy.findUnique.mockResolvedValue({ ...openVacancy, deadline: new Date('2000-01-01') });
    const res = mockRes();

    await applicationDraftController.saveDraft({ body: { vacancyId: '10' }, files: { coverLetter: [coverLetter] }, user: { id: 5, candidateType: 'External' } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(exists('new.pdf')).toBe(false);
  });

  test('cancelling a draft deletes its cover letter and documents', async () => {
    upload('cover.pdf');
    upload('transcript.pdf');
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', coverLetterUrl: '/api/files/cover.pdf' });
    prisma.applicationDocument.findMany.mockResolvedValue([{ id: 7, fileUrl: '/api/files/transcript.pdf' }]);
    prisma.application.delete.mockResolvedValue({});
    const res = mockRes();

    await applicationDraftController.withdraw({ params: { id: '1' }, body: {}, user: { id: 5 } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
    expect(exists('cover.pdf')).toBe(false);
    expect(exists('transcript.pdf')).toBe(false);
  });

  test('removing a document deletes its file', async () => {
    upload('transcript.pdf');
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, status: 'Draft' });
    prisma.applicationDocument.findUnique.mockResolvedValue({ id: 7, applicationId: 1, fileUrl: '/api/files/transcript.pdf' });
    prisma.applicationDocument.delete.mockResolvedValue({});

    await applicationDraftController.removeDocument({ params: { id: '1', documentId: '7' }, user: { id: 5 } }, mockRes());

    expect(exists('transcript.pdf')).toBe(false);
  });

  test('a refused document upload is not kept', async () => {
    const file = upload('extra.pdf');
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, status: 'Draft' });
    const res = mockRes();

    await applicationDraftController.addDocument({ params: { id: '1' }, user: { id: 5 }, file, body: { category: 'Nonsense' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(exists('extra.pdf')).toBe(false);
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
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
    const res = mockRes();

    await applicationDraftController.submit(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('returns 422 when the application is not a Draft (e.g. already submitted)', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1, candidateId: 5, vacancyId: 10, status: 'Submitted', referees: completeReferees
    });
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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
      id: 5, candidateType: 'External', location: null, nationalId: null,
      education: [], workExperience: []
    });
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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
      id: 5, candidateType: 'External', location: 'Kampala', nationalId: 'CM90012345ABCD', districtOfOrigin: 'Wakiso',
      education: [{ id: 1 }], workExperience: [{ id: 1 }]
    });
    prisma.application.updateMany.mockResolvedValue({ count: 0 });
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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
      location: 'Kampala', nationalId: 'CM90012345ABCD', districtOfOrigin: 'Wakiso',
      education: [{ id: 1 }], workExperience: [{ id: 1 }]
    });
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.workExperience.findMany.mockResolvedValue([]);
    prisma.education.findMany.mockResolvedValue([]);
    const req = { params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } };
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

  // Screening at the point of application - an ineligible candidate never
  // reaches the applicant pool.
  describe('screening at submission', () => {
    const completeCandidate = {
      id: 5, email: 'jane@example.com', fullName: 'Jane Doe', candidateType: 'External',
      location: 'Kampala', nationalId: 'CM90012345ABCD', districtOfOrigin: 'Wakiso',
      education: [{ id: 1, qualificationLevel: 'Diploma' }], workExperience: [{ id: 1, startDate: '2015-01-01', endDate: '2020-01-01' }]
    };
    const licenceQuestion = { id: 'q1', text: 'Do you hold a valid ATC licence?', requiredAnswer: 'Yes' };

    function arrange({ application = {}, vacancy = {}, academicDocuments = 1, documents = [] } = {}) {
      prisma.application.findUnique.mockResolvedValue({
        id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees: completeReferees,
        candidate: { candidateType: 'External', internalProfile: null }, ...application
      });
      prisma.vacancy.findUnique.mockResolvedValue({
        id: 10, status: 'Open', postingType: 'External', deadline: null, createdById: 42,
        title: 'Air Traffic Controller', jobRef: 'UCAA/1', reviewStartedAt: null, ...vacancy
      });
      prisma.candidate.findUnique.mockResolvedValue(completeCandidate);
      prisma.applicationDocument.findMany.mockResolvedValue([
        ...Array.from({ length: academicDocuments }, () => ({ category: 'Academic', evidenceKey: null })), ...documents
      ]);
      prisma.application.updateMany.mockResolvedValue({ count: 1 });
      prisma.workExperience.findMany.mockResolvedValue([]);
      prisma.education.findMany.mockResolvedValue([]);
    }

    test('refuses a submission with no academic document attached', async () => {
      arrange({ academicDocuments: 0 });
      const res = mockRes();

      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);

      expect(prisma.applicationDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { applicationId: 1 } }));
      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });

    test('a claim that passes screening needs its evidence attached - the licence for a Yes', async () => {
      const licence = { ...licenceQuestion, evidenceRequired: true, evidenceLabel: 'Your ATC licence' };
      arrange({
        vacancy: { disqualifyingRequirements: [licence] },
        application: { disqualifyingResponses: [{ ...licence, answer: true }] },
        documents: [{ category: 'Other', evidenceKey: null }]
      });
      const res = mockRes();
      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({
        code: 'EVIDENCE_REQUIRED', missing: [expect.objectContaining({ key: 'question:q1', label: 'Your ATC licence' })]
      }));
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });

    test('refuses a candidate who answered a Disqualifying question the wrong way', async () => {
      arrange({
        vacancy: { disqualifyingRequirements: [licenceQuestion] },
        application: { disqualifyingResponses: [{ ...licenceQuestion, answer: false }] }
      });
      const res = mockRes();

      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'NOT_ELIGIBLE', reasons: ['Disqualifying requirement not met: "Do you hold a valid ATC licence?"']
      }));
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });

    test('refuses a candidate whose profile falls below the vacancy minimum', async () => {
      arrange({ vacancy: { minimumEducationLevel: 'Bachelors' } });
      const res = mockRes();

      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_ELIGIBLE' }));
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });

    test('refuses while a Disqualifying question is unanswered', async () => {
      arrange({ vacancy: { disqualifyingRequirements: [licenceQuestion] }, application: { disqualifyingResponses: [] } });
      const res = mockRes();

      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ unanswered: [licenceQuestion.text] }));
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });

    test('an eligible submission enters the pool already screened', async () => {
      arrange({
        vacancy: { disqualifyingRequirements: [licenceQuestion], minimumEducationLevel: 'Diploma' },
        application: { disqualifyingResponses: [{ ...licenceQuestion, answer: true }] }
      });
      const res = mockRes();

      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);

      expect(prisma.application.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'Draft' },
        data: expect.objectContaining({ status: 'Submitted', screeningPassed: true, screenedAt: expect.any(Date) })
      });
    });

    test('screens against the questions as they are at submission, not as they were when the draft was saved', async () => {
      // Saved while the question wanted "No"; HR has since changed it to "Yes".
      arrange({
        vacancy: { disqualifyingRequirements: [{ ...licenceQuestion, requiredAnswer: 'Yes', text: 'Do you hold a current ATC licence?' }] },
        application: { disqualifyingResponses: [{ ...licenceQuestion, requiredAnswer: 'No', answer: true }] }
      });
      const res = mockRes();

      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);

      expect(prisma.application.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'Draft' },
        data: expect.objectContaining({
          screeningPassed: true,
          disqualifyingResponses: [{ id: 'q1', text: 'Do you hold a current ATC licence?', requiredAnswer: 'Yes', answer: true }]
        })
      });
    });

    test('an answer to a question HR has since removed is dropped, and a new question must be answered', async () => {
      arrange({
        vacancy: { disqualifyingRequirements: [{ id: 'q2', text: 'Are you willing to work shifts?', requiredAnswer: 'Yes' }] },
        application: { disqualifyingResponses: [{ ...licenceQuestion, answer: true }] }
      });
      const res = mockRes();

      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ unanswered: ['Are you willing to work shifts?'] }));
    });

    // FR-ATS-038
    test('records when consent was given and against which privacy notice', async () => {
      arrange({ vacancy: {}, application: {} });
      await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'External' } }, mockRes());
      expect(prisma.application.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'Draft' },
        data: expect.objectContaining({ consentGivenAt: expect.any(Date), consentNoticeVersion: PRIVACY_NOTICE_VERSION })
      });
    });

    test.each([undefined, false, 'yes'])('refuses a submission without explicit consent (consent: %p)', async (consent) => {
      arrange({ vacancy: {}, application: {} });
      const res = mockRes();
      await applicationDraftController.submit({ params: { id: '1' }, body: { consent }, user: { id: 5, candidateType: 'External' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('supporting documents', () => {
  const file = { filename: 'abc.pdf', originalname: 'BSc transcript.pdf' };

  test('attaches an academic document to the candidate\'s own draft', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, status: 'Draft' });
    prisma.applicationDocument.count.mockResolvedValue(0);
    prisma.applicationDocument.create.mockResolvedValue({ id: 7 });
    const res = mockRes();

    await applicationDraftController.addDocument({
      params: { id: '1' }, user: { id: 5 }, file, body: { category: 'Academic', label: ' Transcript ' }
    }, res);

    expect(prisma.applicationDocument.create).toHaveBeenCalledWith({
      data: { applicationId: 1, category: 'Academic', label: 'Transcript', evidenceKey: null, fileUrl: '/api/files/abc.pdf', originalName: 'BSc transcript.pdf' }
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('files evidence under one of the vacancy\'s requirements, labelled with it', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, status: 'Draft', vacancyId: 10 });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 10, maximumAge: 35 });
    prisma.applicationDocument.findMany.mockResolvedValue([]);
    prisma.applicationDocument.create.mockResolvedValue({ id: 8 });
    let res = mockRes();
    await applicationDraftController.addDocument({ params: { id: '1' }, user: { id: 5 }, file, body: { category: 'Evidence', evidenceKey: 'nationalId' } }, res);
    expect(prisma.applicationDocument.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      category: 'Evidence', evidenceKey: 'nationalId', label: 'Copy of your National ID'
    }) });

    // Something this vacancy doesn't ask for is refused.
    res = mockRes();
    await applicationDraftController.addDocument({ params: { id: '1' }, user: { id: 5 }, file, body: { category: 'Evidence', evidenceKey: 'flyingHours' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('refuses changes once the application has been submitted', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, status: 'Submitted' });
    const res = mockRes();

    await applicationDraftController.addDocument({ params: { id: '1' }, user: { id: 5 }, file, body: { category: 'Other' } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.applicationDocument.create).not.toHaveBeenCalled();
  });

  test('refuses another candidate\'s application', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 99, status: 'Draft' });
    const res = mockRes();

    await applicationDraftController.removeDocument({ params: { id: '1', documentId: '7' }, user: { id: 5 } }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.applicationDocument.delete).not.toHaveBeenCalled();
  });

  test('does not remove a document that belongs to a different application', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, status: 'Draft' });
    prisma.applicationDocument.findUnique.mockResolvedValue({ id: 7, applicationId: 2 });
    const res = mockRes();

    await applicationDraftController.removeDocument({ params: { id: '1', documentId: '7' }, user: { id: 5 } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.applicationDocument.delete).not.toHaveBeenCalled();
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
    test('a Senior HR Officer sees Submitted/UnderReview plus interviewed candidates not yet on a merit list', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);
      const req = { query: { needsAction: 'true' }, user: { role: 'Senior_HR_Officer' } };
      const res = mockRes();

      await applicationController.list(req, res);

      expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { status: { in: ['Submitted', 'UnderReview'] } },
            { status: 'Interviewed', meritStatus: null }
          ]
        })
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
            { status: 'Interviewed', meritStatus: null },
            { status: 'Interviewed', meritStatus: 'Proposed' },
            { status: 'Interviewed', meritStatus: 'Approved', meritListStatus: 'Primary', offer: null },
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
            { status: 'Interviewed', meritStatus: null },
            { status: 'Interviewed', meritStatus: 'Proposed' },
            { status: 'Interviewed', meritStatus: 'Approved', meritListStatus: 'Primary', offer: null }
          ]
        }
      }));
    });
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
        // Primary/Reserve is no longer decided here (see the merit list) -
        // a listStatus sent by an older client is ignored.
        status: 'ShortlistProposed', rank: 1, listStatus: null, rankVersion: { increment: 1 },
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

  test('approves every ShortlistProposed application for the vacancy in one batch, telling no candidate before EXCO has approved', async () => {
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
    // Not yet - candidates hear once EXCO's signed approval is attached.
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ vacancyId: 5, approvedCount: 2 }));
  });
});
