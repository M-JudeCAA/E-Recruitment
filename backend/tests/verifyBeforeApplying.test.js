// Internal candidates submit applications only once HR has verified their
// UCAA employment details; HR checks them from the Employment checks queue,
// each decision audited and told to the candidate.
jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const { employmentCheck } = require('../src/utils/employmentCheck');
const applicationDraftController = require('../src/controllers/applicationDraftController');
const verification = require('../src/services/internalVerificationService');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const EMPLOYMENT = {
  employeeId: 'UCAA123', department: 'ICT', position: 'Systems Officer', departmentId: 4, positionId: 9,
  dateJoined: '2019-02-01', supervisorName: 'Sam Boss', supervisorEmail: 'sboss@caa.co.ug'
};
const internalCandidate = (profile) => ({
  id: 5, email: 'jane@caa.co.ug', fullName: 'Jane Doe', candidateType: 'Internal',
  location: 'Kampala', nationalId: 'CM90012345ABCD', districtOfOrigin: 'Wakiso',
  education: [{ id: 1, qualificationLevel: 'Diploma' }], workExperience: [{ id: 1, startDate: '2015-01-01', endDate: '2020-01-01' }],
  internalProfile: profile === null ? null : { ...EMPLOYMENT, verificationStatus: 'Pending', verificationEvidenceType: null, ...profile }
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  prisma.candidateNotification.create.mockResolvedValue({});
});

describe('employmentCheck', () => {
  test('external candidates have nothing to check', () => {
    expect(employmentCheck({ candidateType: 'External' })).toEqual(expect.objectContaining({ required: false, verified: true }));
  });

  test.each([
    [{ verificationStatus: 'Pending' }, 'Pending'],
    [{ verificationStatus: 'Discrepancy_Flagged', verificationEvidenceType: 'Comments' }, 'Discrepancy_Flagged'],
    // Verified with no evidence on file isn't verified (the shortlist rule).
    [{ verificationStatus: 'HR_Verified', verificationEvidenceType: null }, 'Pending']
  ])('%j is not verified (%s)', (profile, status) => {
    const check = employmentCheck(internalCandidate(profile));
    expect(check).toEqual(expect.objectContaining({ required: true, verified: false, status }));
    expect(check.message).toBeTruthy();
  });

  test('no employment details yet asks for them', () => {
    expect(employmentCheck(internalCandidate({ departmentId: null })).status).toBe('Missing');
  });

  test('verified with evidence is verified', () => {
    expect(employmentCheck(internalCandidate({ verificationStatus: 'HR_Verified', verificationEvidenceType: 'Comments' })))
      .toEqual(expect.objectContaining({ verified: true, message: null }));
  });
});

describe('submitting an application', () => {
  const referees = [1, 2, 3].map((n) => ({ name: `Referee ${n}`, phone: `070000000${n}`, email: `r${n}@example.com` }));
  function arrange(profile) {
    prisma.application.findUnique.mockResolvedValue({ id: 1, candidateId: 5, vacancyId: 10, status: 'Draft', referees });
    prisma.vacancy.findUnique.mockResolvedValue({ id: 10, status: 'Open', postingType: 'Internal', deadline: null, createdById: 42, title: 'Systems Officer', jobRef: 'UCAA/1' });
    prisma.candidate.findUnique.mockResolvedValue(internalCandidate(profile));
    prisma.applicationDocument.findMany.mockResolvedValue([{ category: 'Academic', evidenceKey: null }]);
  }
  const submit = async () => {
    const res = mockRes();
    await applicationDraftController.submit({ params: { id: '1' }, body: { consent: true }, user: { id: 5, candidateType: 'Internal' } }, res);
    return res;
  };

  test("is refused while HR hasn't verified the candidate's employment - the draft stays", async () => {
    arrange({ verificationStatus: 'Pending' });
    const res = await submit();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMPLOYMENT_NOT_VERIFIED' }));
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('is refused after a discrepancy, saying so', async () => {
    arrange({ verificationStatus: 'Discrepancy_Flagged', verificationEvidenceType: 'Comments' });
    const res = await submit();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMPLOYMENT_NOT_VERIFIED', error: expect.stringMatching(/found a problem/) }));
  });

  test('goes through once verified', async () => {
    arrange({ verificationStatus: 'HR_Verified', verificationEvidenceType: 'Comments' });
    // Reaching the final write is enough: answer it as already submitted.
    prisma.application.updateMany.mockResolvedValue({ count: 0 });
    const res = await submit();
    expect(prisma.application.updateMany).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'EMPLOYMENT_NOT_VERIFIED' }));
  });
});

describe("HR's decision", () => {
  const hr = { user: { id: 7, type: 'staff', role: 'Senior_HR_Officer' } };
  const COMMENT = 'Confirmed with the supervisor by phone on Monday.';

  beforeEach(() => {
    prisma.staffUser.findMany.mockResolvedValue([{ email: 'hr@caa.co.ug', entraObjectId: 'aaa' }]);
    prisma.candidate.findMany.mockResolvedValue([{ id: 70 }]); // the HR officer's own candidate account
    prisma.candidate.findUnique.mockResolvedValue({ id: 5, email: 'jane@caa.co.ug' });
    prisma.internalProfile.findUnique.mockResolvedValue({ candidateId: 5, ...EMPLOYMENT, verificationStatus: 'Pending', supportingDocumentUrl: null });
    prisma.internalProfile.update.mockImplementation(async ({ data }) => ({ candidateId: 5, ...EMPLOYMENT, ...data }));
  });

  test('verifying is audited before and after, and the candidate is told they can apply', async () => {
    await verification.decide(hr, 5, { decision: 'HR_Verified', comments: COMMENT });

    expect(prisma.internalProfile.update).toHaveBeenCalledWith({
      where: { candidateId: 5, verificationStatus: 'Pending' },
      data: expect.objectContaining({ verificationStatus: 'HR_Verified', verificationEvidenceType: 'Comments', verifiedById: 7 })
    });
    const auditRow = prisma.auditLog.create.mock.calls[0][0].data;
    expect(auditRow).toEqual(expect.objectContaining({ entityType: 'InternalProfile', entityId: 5, action: 'Employment verified' }));
    expect(auditRow.payload.changes.verificationStatus).toEqual({ from: 'Pending', to: 'HR_Verified' });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ candidateId: 5, type: 'EmploymentVerified' }) });
  });

  test('a discrepancy tells the candidate to check their details', async () => {
    await verification.decide(hr, 5, { decision: 'Discrepancy_Flagged', comments: COMMENT });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'EmploymentDiscrepancy' }) });
  });

  test('needs evidence', async () => {
    await expect(verification.decide(hr, 5, { decision: 'HR_Verified', comments: ' ' })).rejects.toMatchObject({ status: 422 });
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test('a comment of any length is evidence enough', async () => {
    await verification.decide(hr, 5, { decision: 'HR_Verified', comments: 'ok' });
    expect(prisma.internalProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verificationComments: 'ok', verificationEvidenceType: 'Comments' })
    }));
  });

  test('nobody checks their own employment', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue({ candidateId: 70, ...EMPLOYMENT, verificationStatus: 'Pending' });
    await expect(verification.decide(hr, 70, { decision: 'HR_Verified', comments: COMMENT }))
      .rejects.toMatchObject({ status: 403, code: 'SELF_VERIFICATION' });
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test.each(['HR_Verified', 'Discrepancy_Flagged'])("can't decide (%s) while a flagged discrepancy waits for the candidate", async (decision) => {
    prisma.internalProfile.findUnique.mockResolvedValue({ candidateId: 5, ...EMPLOYMENT, verificationStatus: 'Discrepancy_Flagged' });
    await expect(verification.decide(hr, 5, { decision, comments: COMMENT }))
      .rejects.toMatchObject({ status: 409, code: 'DISCREPANCY_NOT_RESOLVED' });
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
  });

  test('two of HR deciding at once: the second is refused', async () => {
    prisma.internalProfile.update.mockRejectedValue(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));
    await expect(verification.decide(hr, 5, { decision: 'HR_Verified', comments: COMMENT }))
      .rejects.toMatchObject({ status: 409, code: 'CHECK_CHANGED' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('a failed notice does not undo the decision', async () => {
    prisma.candidateNotification.create.mockRejectedValue(new Error('db blip'));
    await expect(verification.decide(hr, 5, { decision: 'HR_Verified', comments: COMMENT })).resolves.toEqual(expect.objectContaining({ verificationStatus: 'HR_Verified' }));
  });
});

describe('the queue', () => {
  const hr = { user: { id: 7, type: 'staff', role: 'Senior_HR_Officer' } };
  const row = (candidateId, extra = {}, applications = []) => ({
    candidateId, ...EMPLOYMENT, verificationStatus: 'Pending', verificationEvidenceType: null, detailsUpdatedAt: null, verifiedBy: null,
    candidate: { id: candidateId, fullName: `Person ${candidateId}`, email: `p${candidateId}@caa.co.ug`, createdAt: new Date('2026-10-01'), applications },
    ...extra
  });

  test("leaves out the viewer's own profile and lists the oldest wait first", async () => {
    prisma.staffUser.findMany.mockResolvedValue([{ email: 'hr@caa.co.ug', entraObjectId: null }]);
    prisma.candidate.findMany.mockResolvedValue([{ id: 70 }]);
    prisma.internalProfile.findMany.mockResolvedValue([
      row(1, { detailsUpdatedAt: new Date('2026-10-20') }),
      row(2, { detailsUpdatedAt: new Date('2026-10-10') }, [{ id: 9, status: 'UnderReview', vacancy: { id: 3, jobRef: 'R3', title: 'T' } }])
    ]);

    const list = await verification.queue(hr);

    expect(prisma.internalProfile.findMany.mock.calls[0][0].where.candidate.id).toEqual({ notIn: [70] });
    expect(list.map((p) => p.candidateId)).toEqual([2, 1]);
    expect(list[0].applications).toEqual([{ id: 9, status: 'UnderReview', vacancyId: 3, jobRef: 'R3', title: 'T' }]);

    const summary = await verification.waitingSummary(hr);
    expect(summary).toEqual({ count: 2, oldest: new Date('2026-10-10'), withApplications: 1 });
  });

  test('a check waiting again carries the earlier decision and what changed since', async () => {
    prisma.staffUser.findMany.mockResolvedValue([]);
    prisma.internalProfile.findMany.mockResolvedValue([row(1, { verificationComments: 'Wrong number.' }), row(2)]);
    prisma.auditLog.findMany.mockResolvedValue([
      { entityId: 1, action: 'Employment discrepancy flagged', timestamp: new Date('2026-10-20'), payload: { comment: 'Wrong number.' }, performedBy: { name: 'Hope' } },
      { entityId: 1, action: 'Employment details changed - back to HR for checking', timestamp: new Date('2026-10-21'),
        payload: { changes: { employeeId: { from: 'U9', to: 'U1' }, verificationStatus: { from: 'Discrepancy_Flagged', to: 'Pending' } } } },
      { entityId: 1, action: 'Employment details changed - back to HR for checking', timestamp: new Date('2026-10-22'),
        payload: { changes: { employeeId: { from: 'U1', to: 'U12' } } } }
    ]);

    const [first, second] = await verification.queue(hr);

    expect(prisma.auditLog.findMany.mock.calls[0][0].where.entityId).toEqual({ in: [1, 2] });
    expect(first.previousCheck).toEqual({
      decision: 'Discrepancy_Flagged', by: 'Hope', at: new Date('2026-10-20'), comments: 'Wrong number.',
      changes: { employeeId: { from: 'U9', to: 'U12' } }
    });
    // Never checked before - nothing to show.
    expect(second.previousCheck).toBeUndefined();
  });
});

describe('the Inbox item', () => {
  const inbox = require('../src/services/inboxService');

  test.each(['HR_Officer', 'Senior_HR_Officer', 'Manager', 'Director'])('%s sees one item for everyone waiting', async (role) => {
    prisma.delegation.findFirst.mockResolvedValue(null);
    prisma.vacancy.findMany.mockResolvedValue([]);
    prisma.staffUser.findMany.mockResolvedValue([]);
    prisma.internalProfile.findMany.mockResolvedValue([
      { candidateId: 1, ...EMPLOYMENT, verificationStatus: 'Pending', detailsUpdatedAt: new Date(Date.now() - 3 * 86400000), verifiedBy: null,
        candidate: { id: 1, fullName: 'A', email: 'a@caa.co.ug', createdAt: new Date(), applications: [] } }
    ]);

    const { items } = await inbox.forStaff({ user: { id: 7, type: 'staff', role } });

    const item = items.find((i) => i.key === 'employment-checks');
    expect(item).toEqual(expect.objectContaining({ link: '/hr/verification', count: 1, title: '1 internal candidate waiting for an employment check' }));
  });
});
