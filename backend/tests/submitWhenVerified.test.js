// "Submit when verified": an Internal candidate whose UCAA employment HR
// hasn't verified yet queues an application, and it goes in by itself when
// HR verifies them - on time if it was queued before the deadline.
jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/services/conflictOfInterestService', () => ({
  noticeRecipients: jest.fn(async (_v, ids) => ({ ids, redirected: false })),
  flagStaffApplicant: jest.fn(async () => {}),
  flagHiringManagerApplicant: jest.fn(async () => {})
}));
jest.mock('../src/services/notificationService', () => ({ notify: jest.fn(async () => {}), notifyAllHrStaff: jest.fn(async () => {}) }));
jest.mock('../src/services/workflowService', () => ({ captureSnapshot: jest.fn(async () => {}) }));

const prisma = require('../src/config/db');
const submission = require('../src/services/applicationSubmissionService');
const applicationDraftController = require('../src/controllers/applicationDraftController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const referees = [1, 2, 3].map((n) => ({ name: `Referee ${n}`, phone: `070000000${n}`, email: `r${n}@example.com` }));
const EMPLOYMENT = { employeeId: 'UCAA123', department: 'ICT', position: 'Systems Officer', departmentId: 4, positionId: 9, dateJoined: '2019-02-01' };
const candidate = (verified) => ({
  id: 5, email: 'jane@caa.co.ug', fullName: 'Jane Doe', candidateType: 'Internal',
  location: 'Kampala', nationalId: 'CM90012345ABCD', districtOfOrigin: 'Wakiso',
  education: [{ id: 1, qualificationLevel: 'Diploma' }], workExperience: [{ id: 1, startDate: '2015-01-01', endDate: '2020-01-01' }],
  internalProfile: verified
    ? { ...EMPLOYMENT, verificationStatus: 'HR_Verified', verificationEvidenceType: 'Comments' }
    : { ...EMPLOYMENT, verificationStatus: 'Pending', verificationEvidenceType: null }
});
const vacancy = (extra = {}) => ({ id: 10, status: 'Open', postingType: 'Internal', deadline: null, createdById: 42, title: 'Systems Officer', jobRef: 'UCAA/1', ...extra });
const draft = (extra = {}) => ({ id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees, ...extra });

function arrange({ verified, application = draft(), vac = vacancy() }) {
  prisma.application.findUnique.mockResolvedValue(application);
  prisma.application.updateMany.mockResolvedValue({ count: 1 });
  prisma.vacancy.findUnique.mockResolvedValue(vac);
  prisma.candidate.findUnique.mockResolvedValue({ ...candidate(verified), purgedAt: null, tokenVersion: 0 });
  prisma.applicationDocument.findMany.mockResolvedValue([{ category: 'Academic', evidenceKey: null }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.candidateNotification.create.mockResolvedValue({});
});

const call = async (handler, body = { consent: true }) => {
  const res = mockRes();
  await applicationDraftController[handler]({ params: { id: '1' }, body, user: { id: 5, type: 'candidate', candidateType: 'Internal' } }, res);
  return res;
};

describe('queuing an application', () => {
  test('while unverified: every other check passes and it is marked to submit, still a draft', async () => {
    arrange({ verified: false });
    const res = await call('submitWhenVerified');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ queued: true }));
    const { where, data } = prisma.application.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 1, status: 'Draft' });
    expect(data.submitWhenVerifiedAt).toBeInstanceOf(Date);
    expect(data.consentGivenAt).toBeInstanceOf(Date);
    expect(data.status).toBeUndefined();
  });

  test('still needs consent and the other checks', async () => {
    arrange({ verified: false });
    expect((await call('submitWhenVerified', {})).json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
    arrange({ verified: false, application: draft({ referees: [] }) });
    expect((await call('submitWhenVerified')).status).toHaveBeenCalledWith(400);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test('already verified: it is simply submitted', async () => {
    arrange({ verified: true });
    const res = await call('submitWhenVerified');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ submitted: true }));
    expect(prisma.application.updateMany.mock.calls[0][0].data.status).toBe('Submitted');
  });

  test('can be cancelled - an ordinary draft again', async () => {
    arrange({ verified: false, application: draft({ submitWhenVerifiedAt: new Date() }) });
    await call('cancelSubmitWhenVerified');
    expect(prisma.application.updateMany.mock.calls[0][0].data).toEqual({ submitWhenVerifiedAt: null });
  });
});

describe('when HR verifies', () => {
  test('a queued application is submitted, and the candidate told', async () => {
    arrange({ verified: true });
    prisma.application.findMany.mockResolvedValue([draft({ submitWhenVerifiedAt: new Date() })]);
    const out = await submission.submitQueued(5);
    expect(out.submitted).toEqual([1]);
    expect(prisma.application.updateMany.mock.calls[0][0].data.status).toBe('Submitted');
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'ApplicationSubmitted', message: expect.stringMatching(/submitted, as you asked/) }) });
  });

  test('queued before the deadline counts as on time, even when HR verifies after it', async () => {
    const deadline = new Date(Date.now() - 24 * 3600 * 1000); // passed yesterday
    arrange({ verified: true, vac: vacancy({ deadline }) });
    prisma.application.findMany.mockResolvedValue([draft({ submitWhenVerifiedAt: new Date(deadline.getTime() - 3600 * 1000) })]);
    const out = await submission.submitQueued(5);
    expect(out.submitted).toEqual([1]);
  });

  test('one that no longer passes stays a draft, off the queue, and the candidate is told why', async () => {
    arrange({ verified: true, vac: vacancy({ status: 'Closed' }) });
    prisma.application.findMany.mockResolvedValue([draft({ submitWhenVerifiedAt: new Date() })]);
    const out = await submission.submitQueued(5);
    expect(out.notSubmitted).toEqual([1]);
    expect(prisma.application.updateMany.mock.calls[0][0].data).toEqual({ submitWhenVerifiedAt: null });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'QueuedApplicationNotSubmitted' }) });
  });

  test('an erased candidate has nothing submitted', async () => {
    arrange({ verified: true });
    prisma.candidate.findUnique.mockResolvedValue({ id: 5, candidateType: 'Internal', purgedAt: new Date(), tokenVersion: 0 });
    prisma.application.findMany.mockResolvedValue([draft({ submitWhenVerifiedAt: new Date() })]);
    expect(await submission.submitQueued(5)).toEqual({ submitted: [], notSubmitted: [] });
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });
});
