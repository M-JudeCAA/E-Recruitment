jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/realtime/dashboardSocket', () => ({ broadcastDashboardEvent: jest.fn() }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const hr = require('../src/controllers/shortlistCommitteeController');
const panel = require('../src/controllers/shortlistPanelController');
const vacancyController = require('../src/controllers/vacancyController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.sendFile = jest.fn();
  return res;
}

const E1 = { id: 'e1e1e1', kind: 'Essential', label: 'Degree', weight: 1 };
const D1 = { id: 'd1d1d1', kind: 'Desirable', label: 'Masters', weight: 1 };
const VACANCY = { id: 3, jobRef: 'UCAA/1', title: 'Air Traffic Controller', positionsRequired: 1, deadline: new Date('2020-01-01'), reviewStartedAt: new Date() };
const MEMBERS = [
  { id: 1, name: 'Chair Person', email: 'chair@example.test', isChair: true, token: 't1', submittedAt: new Date() },
  { id: 2, name: 'Member Two', email: 'two@example.test', isChair: false, token: 't2', submittedAt: new Date() },
  { id: 3, name: 'Member Three', email: 'three@example.test', isChair: false, token: 't3', submittedAt: new Date() }
];

function exercise(overrides = {}) {
  return { id: 7, vacancyId: 3, status: 'Setup', criteria: [E1, D1], ratersPerApplicant: 3, calibrationCount: 10, members: MEMBERS, decisions: [], ...overrides };
}

// Assignments with ratings: votes[applicationId] = [[e1, d1] per member 1..3].
function assignmentsFor(votes) {
  return Object.entries(votes).flatMap(([applicationId, perMember]) => perMember.map(([e1, d1], i) => ({
    id: Number(applicationId) * 10 + i, memberId: MEMBERS[i].id, applicationId: Number(applicationId), conflictAt: null,
    member: MEMBERS[i],
    ratings: [{ criterionId: 'e1e1e1', value: e1, comment: null }, { criterionId: 'd1d1d1', value: d1, comment: null }]
  })));
}

function appsFor(ids) {
  return ids.map((id) => ({ id, status: 'UnderReview', rankVersion: 0, candidate: { fullName: `Candidate ${id}`, workExperience: [] } }));
}

const params = { vacancyId: '3' };
const staff = { user: { id: 50 } };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.vacancy.findUnique.mockResolvedValue(VACANCY);
  prisma.shortlistExercise.findUnique.mockResolvedValue(exercise());
  prisma.shortlistExercise.updateMany.mockResolvedValue({ count: 1 });
  prisma.application.findMany.mockResolvedValue([]);
  prisma.application.count.mockResolvedValue(0);
  prisma.shortlistAssignment.findMany.mockResolvedValue([]);
  prisma.staffUser.findFirst.mockResolvedValue(null);
  prisma.$transaction = jest.fn((ops) => Promise.all(ops));
  sendMail.mockResolvedValue({ messageId: 'x' });
});

describe('committee membership', () => {
  test('HR staff can never sit on the committee', async () => {
    prisma.staffUser.findFirst.mockResolvedValue({ id: 9, email: 'hro@caa.co.ug' });
    const res = mockRes();
    await hr.addMember({ ...staff, params, body: { name: 'An HR Officer', email: 'HRO@caa.co.ug' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.shortlistMember.create).not.toHaveBeenCalled();
  });

  test('rating needs at least three members and a chair', async () => {
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ members: MEMBERS.slice(0, 2) }));
    const res = mockRes();
    await hr.openRating({ ...staff, params, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.shortlistExercise.updateMany).not.toHaveBeenCalled();
  });

  test('opening rating assigns every screened applicant and emails each member their link', async () => {
    prisma.application.findMany.mockResolvedValue([{ id: 100 }, { id: 101 }]);
    const res = mockRes();
    await hr.openRating({ ...staff, params, body: {} }, res);
    expect(prisma.shortlistAssignment.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([{ memberId: 1, applicationId: 100, calibration: false }]), skipDuplicates: true
    });
    expect(prisma.shortlistAssignment.createMany.mock.calls[0][0].data).toHaveLength(6);
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'chair@example.test', html: expect.stringContaining('/shortlist-panel/t1') }));
  });

  test('rating waits for the application deadline', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ ...VACANCY, deadline: new Date(Date.now() + 86400000) });
    const res = mockRes();
    await hr.openRating({ ...staff, params, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe('moving through the stages', () => {
  test('closing rating with members still to submit needs HR to confirm', async () => {
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Rating', members: [MEMBERS[0], { ...MEMBERS[1], submittedAt: null }, MEMBERS[2]] }));
    const res = mockRes();
    await hr.startModeration({ ...staff, params, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MEMBERS_NOT_SUBMITTED', pending: ['Member Two'] }));
  });

  test('the exercise cannot close while a dispute is unsettled', async () => {
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Moderation' }));
    prisma.shortlistAssignment.findMany.mockResolvedValue(assignmentsFor({ 100: [[2, 3], [1, 3], [0, 3]] }));
    prisma.application.findMany.mockResolvedValue(appsFor([100]));
    const res = mockRes();
    await hr.close({ ...staff, params, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.shortlistExercise.updateMany).not.toHaveBeenCalled();
  });

  test('closing snapshots each applicant\'s rank, band and score', async () => {
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Moderation' }));
    prisma.shortlistAssignment.findMany.mockResolvedValue(assignmentsFor({
      100: [[2, 3], [2, 3], [2, 3]], // unanimous
      101: [[2, 5], [2, 5], [0, 5]] // majority, better desirable
    }));
    prisma.application.findMany.mockResolvedValue(appsFor([100, 101]));
    const res = mockRes();
    await hr.close({ ...staff, params, body: {} }, res);
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 100 }, data: expect.objectContaining({ committeeRank: 1, committeeBand: 'Unanimous' })
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 101 }, data: expect.objectContaining({ committeeRank: 2, committeeBand: 'Majority' })
    });
  });
});

describe('covering conflicts', () => {
  // Applicant 100: Member Two and Member Three stood down, leaving only the chair.
  function conflicted() {
    return assignmentsFor({ 100: [[2, 3], [2, 3], [2, 3]] })
      .map((a) => (a.memberId === 1 ? a : { ...a, conflictAt: new Date(), conflictReason: 'Knows the applicant', ratings: [] }));
  }

  test('during rating HR sees applicants left with too few raters, and who could be added', async () => {
    const fourth = { id: 4, name: 'Member Four', email: 'four@example.test', isChair: false, token: 't4', submittedAt: null };
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Rating', members: [...MEMBERS, fourth] }));
    prisma.shortlistAssignment.findMany.mockResolvedValue(conflicted());
    prisma.application.findMany.mockResolvedValueOnce([]).mockResolvedValue(appsFor([100]));
    const res = mockRes();
    await hr.get({ ...staff, params }, res);
    const { exercise: ex } = res.json.mock.calls[0][0];
    expect(ex.results).toBeNull();
    expect(ex.coverage).toEqual([expect.objectContaining({ applicationId: 100, available: [{ id: 4, name: 'Member Four' }] })]);
  });

  test('adding a rater assigns them and tells them by email', async () => {
    const fourth = { id: 4, name: 'Member Four', email: 'four@example.test', isChair: false, token: 't4', submittedAt: null };
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Rating', members: [...MEMBERS, fourth] }));
    prisma.shortlistAssignment.findMany.mockResolvedValue(conflicted());
    prisma.application.findMany.mockResolvedValue(appsFor([100]));
    const res = mockRes();
    await hr.addAssignment({ ...staff, params, body: { memberId: 4, applicationId: 100 } }, res);
    expect(prisma.shortlistAssignment.createMany).toHaveBeenCalledWith({ data: [{ memberId: 4, applicationId: 100, calibration: false }], skipDuplicates: true });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'four@example.test', html: expect.stringContaining('Candidate 100') }));
  });

  test('an acting chair is never the chair, nor someone who stood down from the applicant', async () => {
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Moderation' }));
    prisma.shortlistAssignment.findMany.mockResolvedValue(conflicted());
    const asChair = mockRes();
    await hr.setActingChair({ ...staff, params, body: { applicationId: 100, memberId: 1 } }, asChair);
    expect(asChair.status).toHaveBeenCalledWith(422);
    const asConflicted = mockRes();
    await hr.setActingChair({ ...staff, params, body: { applicationId: 100, memberId: 2 } }, asConflicted);
    expect(asConflicted.status).toHaveBeenCalledWith(422);
    expect(prisma.shortlistExercise.update).not.toHaveBeenCalled();
  });

  test('naming an acting chair at moderation saves it and emails them', async () => {
    // The chair (member 1) stood down from applicant 100; members 2 and 3 rated.
    const chairConflicted = assignmentsFor({ 100: [[2, 3], [1, 3], [0, 3]] })
      .map((a) => (a.memberId === 1 ? { ...a, conflictAt: new Date(), conflictReason: 'Relative', ratings: [] } : a));
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Moderation' }));
    prisma.shortlistAssignment.findMany.mockResolvedValue(chairConflicted);
    prisma.application.findMany.mockResolvedValue(appsFor([100]));
    const res = mockRes();
    await hr.setActingChair({ ...staff, params, body: { applicationId: 100, memberId: 3 } }, res);
    expect(prisma.shortlistExercise.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { actingChairs: [{ applicationId: 100, memberId: 3 }] } });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'three@example.test', html: expect.stringContaining('in the chair\'s place') }));
  });
});

describe('proposing the interview shortlist', () => {
  beforeEach(() => {
    prisma.shortlistExercise.findUnique.mockResolvedValue(exercise({ status: 'Closed' }));
    prisma.application.findMany.mockResolvedValue([
      { id: 100, status: 'UnderReview', committeeRank: 1, committeeBand: 'Unanimous' },
      { id: 101, status: 'UnderReview', committeeRank: 2, committeeBand: 'Majority' },
      { id: 102, status: 'UnderReview', committeeRank: 2, committeeBand: 'Majority' },
      { id: 103, status: 'UnderReview', committeeRank: 4, committeeBand: 'NotQualified' }
    ]);
    prisma.application.findUnique.mockResolvedValue({ id: 100, candidate: { candidateType: 'External' } });
  });

  test('takes the top N strictly in committee order, with ties at the cut line', async () => {
    const res = mockRes();
    await hr.propose({ ...staff, params, body: { count: 2 } }, res);
    expect(res.json).toHaveBeenCalledWith({ proposed: 3, applicationIds: [100, 101, 102] });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 101 }, data: expect.objectContaining({ rank: 2, status: 'ShortlistProposed', shortlistProposedById: 50 })
    });
  });

  test('never reaches an applicant the committee found not qualified', async () => {
    const res = mockRes();
    await hr.propose({ ...staff, params, body: { count: 4 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('HR can no longer rank a committee-run vacancy by hand', async () => {
    const res = mockRes();
    await vacancyController.saveRanking({ ...staff, params: { id: '3' }, body: { applicationIds: [102, 100], applicationRankVersions: { 100: 0, 102: 0 } } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('a member\'s link', () => {
  const member = (overrides = {}) => ({
    ...MEMBERS[1], submittedAt: null,
    exercise: { ...exercise({ status: 'Rating' }), vacancy: { id: 3, jobRef: 'UCAA/1', title: 'ATC', positionsRequired: 1 } },
    ...overrides
  });

  beforeEach(() => {
    prisma.shortlistMember.findUnique.mockResolvedValue(member());
    prisma.shortlistAssignment.findUnique.mockResolvedValue({ id: 55, memberId: 2, applicationId: 100, conflictAt: null, ratings: [] });
  });

  test('a member sees only their own assignments, never other members\' ratings', async () => {
    prisma.shortlistAssignment.findMany.mockResolvedValue([
      { applicationId: 100, calibration: true, conflictAt: null, ratings: [{ criterionId: 'e1e1e1', value: 2 }], application: { id: 100, candidate: { fullName: 'Candidate 100' } } }
    ]);
    const res = mockRes();
    await panel.view({ params: { token: 't2' } }, res);
    expect(prisma.shortlistAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: 2 } }));
    const body = res.json.mock.calls[0][0];
    expect(body.applicants).toEqual([expect.objectContaining({ applicationId: 100, rated: 1, complete: false })]);
    expect(body.disputes).toBeUndefined();
  });

  test('a "Not met" on an essential criterion needs a reason', async () => {
    const res = mockRes();
    await panel.saveRatings({ params: { token: 't2', applicationId: '100' }, body: { ratings: [{ criterionId: 'e1e1e1', value: 0 }] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.shortlistRating.upsert).not.toHaveBeenCalled();
  });

  test('ratings are saved against the member\'s own assignment', async () => {
    const res = mockRes();
    await panel.saveRatings({ params: { token: 't2', applicationId: '100' }, body: { ratings: [{ criterionId: 'e1e1e1', value: 2 }, { criterionId: 'd1d1d1', value: 4 }] } }, res);
    expect(prisma.shortlistRating.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.shortlistRating.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignmentId_criterionId: { assignmentId: 55, criterionId: 'd1d1d1' } }
    }));
  });

  test('submitted ratings are locked', async () => {
    prisma.shortlistMember.findUnique.mockResolvedValue(member({ submittedAt: new Date() }));
    const res = mockRes();
    await panel.saveRatings({ params: { token: 't2', applicationId: '100' }, body: { ratings: [{ criterionId: 'd1d1d1', value: 4 }] } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('submitting needs every assigned applicant fully rated', async () => {
    prisma.shortlistAssignment.findMany.mockResolvedValue([
      { applicationId: 100, conflictAt: null, ratings: [{ criterionId: 'e1e1e1', value: 2 }], application: { id: 100, candidate: { fullName: 'A' } } }
    ]);
    const res = mockRes();
    await panel.submit({ params: { token: 't2' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.shortlistMember.updateMany).not.toHaveBeenCalled();
  });

  test('only the chair rules on disputes', async () => {
    prisma.shortlistMember.findUnique.mockResolvedValue(member({ exercise: { ...member().exercise, status: 'Moderation' } }));
    const res = mockRes();
    await panel.decide({ params: { token: 't2' }, body: { applicationId: 100, criterionId: 'e1e1e1', outcome: 'Met', reason: 'Agreed at the meeting' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('the chair rules on a disputed item', async () => {
    prisma.shortlistMember.findUnique.mockResolvedValue({ ...member({ exercise: { ...member().exercise, status: 'Moderation' } }), ...MEMBERS[0], exercise: { ...member().exercise, status: 'Moderation' } });
    prisma.shortlistAssignment.findMany.mockResolvedValue(assignmentsFor({ 100: [[2, 3], [1, 3], [0, 3]] }));
    prisma.application.findMany.mockResolvedValue(appsFor([100]));
    const res = mockRes();
    await panel.decide({ params: { token: 't1' }, body: { applicationId: 100, criterionId: 'e1e1e1', outcome: 'Met', reason: 'Degree confirmed from transcript' } }, res);
    expect(prisma.shortlistDecision.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ outcome: 'Met', decidedByName: 'Chair Person' })
    }));
  });

  describe('when the chair stood down from an applicant', () => {
    const moderation = (overrides = {}) => ({ ...exercise({ status: 'Moderation', ...overrides }), vacancy: { id: 3, jobRef: 'UCAA/1', title: 'ATC', positionsRequired: 1 } });
    beforeEach(() => {
      // Chair (1) conflicted on 100; members 2 and 3 split on the essential.
      prisma.shortlistAssignment.findMany.mockResolvedValue(assignmentsFor({ 100: [[2, 3], [2, 3], [0, 3]] })
        .map((a) => (a.memberId === 1 ? { ...a, conflictAt: new Date(), conflictReason: 'Relative', ratings: [] } : a)));
      prisma.application.findMany.mockResolvedValue(appsFor([100]));
    });
    const ruling = { applicationId: 100, criterionId: 'e1e1e1', outcome: 'Met', reason: 'Degree confirmed' };

    test('the chair cannot rule on them', async () => {
      prisma.shortlistMember.findUnique.mockResolvedValue({ ...MEMBERS[0], exercise: moderation() });
      const res = mockRes();
      await panel.decide({ params: { token: 't1' }, body: ruling }, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.shortlistDecision.upsert).not.toHaveBeenCalled();
    });

    test('the acting chair HR named sees the items and rules on them', async () => {
      const acting = { ...MEMBERS[2], submittedAt: new Date(), exercise: moderation({ actingChairs: [{ applicationId: 100, memberId: 3 }] }) };
      prisma.shortlistMember.findUnique.mockResolvedValue(acting);
      prisma.shortlistAssignment.findMany.mockResolvedValueOnce([
        { applicationId: 100, calibration: false, conflictAt: null, ratings: [], application: { id: 100, candidate: { fullName: 'Candidate 100' } } }
      ]);
      const viewRes = mockRes();
      await panel.view({ params: { token: 't3' } }, viewRes);
      expect(viewRes.json.mock.calls[0][0].disputes).toEqual([expect.objectContaining({ applicationId: 100, canRule: true })]);

      const res = mockRes();
      await panel.decide({ params: { token: 't3' }, body: ruling }, res);
      expect(prisma.shortlistDecision.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ decidedByName: 'Member Three', decidedByMemberId: 3 })
      }));
    });
  });

  test('a document opens only if it belongs to one of the member\'s applicants', async () => {
    prisma.shortlistAssignment.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await panel.file({ params: { token: 't2', filename: 'abc.pdf' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  test('a link stops working once the exercise closes', async () => {
    prisma.shortlistMember.findUnique.mockResolvedValue(member({ exercise: { ...member().exercise, status: 'Closed' } }));
    const res = mockRes();
    await panel.view({ params: { token: 't2' } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
  });
});
