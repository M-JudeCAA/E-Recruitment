jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const meritList = require('../src/services/meritListService');
const meritListController = require('../src/controllers/meritListController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// An interviewed application as meritListService loads it.
function interviewed(id, { score = 70, recommendation = 'Shortlist', ...overrides } = {}) {
  return {
    id, vacancyId: 3, status: 'Interviewed', rankVersion: 0, shortlistScore: null,
    meritRank: null, meritListStatus: null, meritStatus: null,
    candidate: { id: 100 + id, fullName: `Candidate ${id}`, candidateType: 'External' },
    interviewRounds: [{ id: 50 + id, roundNumber: 1, status: 'Completed', score, recommendation, panelMembers: [] }],
    offer: null,
    ...overrides
  };
}

beforeEach(() => jest.clearAllMocks());

describe('assignListStatus', () => {
  test('makes the first positionsRequired "Shortlist" candidates Primary and the rest Reserve', () => {
    expect(meritList.assignListStatus(['Shortlist', 'Shortlist', 'Shortlist', 'Hold'], 2))
      .toEqual(['Primary', 'Primary', 'Reserve', 'Reserve']);
  });

  test('never makes a "Hold" candidate Primary, even with positions to spare', () => {
    expect(meritList.assignListStatus(['Shortlist', 'Hold'], 3)).toEqual(['Primary', 'Reserve']);
  });

  test('refuses a "Hold" ranked above a "Shortlist"', () => {
    expect(() => meritList.assignListStatus(['Hold', 'Shortlist'], 1)).toThrow(/cannot be ranked above/);
  });
});

describe('interviewOutcome', () => {
  test('uses the latest round that took place, skipping cancelled and no-show rounds', () => {
    const app = interviewed(1, {
      interviewRounds: [
        { id: 1, roundNumber: 1, status: 'Completed', score: 80, recommendation: 'Shortlist' },
        { id: 2, roundNumber: 2, status: 'NoShow', score: null, recommendation: null }
      ]
    });
    expect(meritList.interviewOutcome(app)).toMatchObject({ score: 80, recommendation: 'Shortlist' });
  });

  test('is null for a "Reject" verdict or an unfinalized round', () => {
    expect(meritList.interviewOutcome(interviewed(1, { recommendation: 'Reject' }))).toBeNull();
    expect(meritList.interviewOutcome(interviewed(1, { recommendation: null }))).toBeNull();
  });
});

describe('getBoard', () => {
  test('splits the vacancy into the list, eligible candidates and those still being interviewed', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, jobRef: 'REF', title: 'ATC', positionsRequired: 1, status: 'Open' });
    prisma.application.findMany.mockResolvedValue([
      interviewed(1, { score: 60, recommendation: 'Hold' }),
      interviewed(2, { score: 90 }),
      interviewed(3, { recommendation: null }),
      { ...interviewed(4), status: 'InterviewScheduled', interviewRounds: [] }
    ]);

    const board = await meritList.getBoard(3);

    expect(board.state).toBe('NotStarted');
    expect(board.locked).toBe(false);
    expect(board.entries).toEqual([]);
    expect(board.eligible.map((r) => r.applicationId)).toEqual([2, 1]);
    expect(board.awaiting.map((r) => r.applicationId).sort()).toEqual([3, 4]);
    // "Shortlist" before "Hold", then by score.
    expect(board.suggestedOrder).toEqual([2, 1]);
  });

  test('reports a proposed list and locks once an offer is in play', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, jobRef: 'REF', title: 'ATC', positionsRequired: 1, status: 'Open' });
    prisma.application.findMany.mockResolvedValue([
      { ...interviewed(1), status: 'Offered', meritRank: 1, meritListStatus: 'Primary', meritStatus: 'Approved', offer: { id: 9, status: 'Recommended' } },
      interviewed(2, { meritRank: 2, meritListStatus: 'Reserve', meritStatus: 'Approved' })
    ]);

    const board = await meritList.getBoard(3);

    expect(board.state).toBe('Approved');
    expect(board.locked).toBe(true);
    expect(board.entries.map((r) => [r.applicationId, r.meritListStatus, r.offerStatus]))
      .toEqual([[1, 'Primary', 'Recommended'], [2, 'Reserve', null]]);
  });

  test('404s for an unknown vacancy', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    await expect(meritList.getBoard(3)).rejects.toMatchObject({ status: 404 });
  });
});

describe('propose', () => {
  beforeEach(() => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, jobRef: 'REF', title: 'ATC', positionsRequired: 1 });
    prisma.application.update.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
  });

  test('writes the ranking with Primary/Reserve and drops candidates left off a previous list', async () => {
    prisma.application.findMany.mockResolvedValue([
      interviewed(1, { score: 90 }),
      interviewed(2, { score: 80 }),
      interviewed(3, { meritRank: 2, meritListStatus: 'Reserve', meritStatus: 'Approved', rankVersion: 4 })
    ]);

    const result = await meritList.propose(3, [2, 1], { 1: 0, 2: 0, 3: 4 }, 9);

    expect(result).toMatchObject({ primaryCount: 1, reserveCount: 1 });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: expect.objectContaining({ meritRank: 1, meritListStatus: 'Primary', meritStatus: 'Proposed', meritProposedById: 9, rankVersion: { increment: 1 } })
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ meritRank: 2, meritListStatus: 'Reserve', meritStatus: 'Proposed' })
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ meritRank: null, meritListStatus: null, meritStatus: null })
    });
  });

  test('refuses a candidate who is not interviewed or whose verdict was "Reject"', async () => {
    prisma.application.findMany.mockResolvedValue([interviewed(1), interviewed(2, { recommendation: 'Reject' })]);
    await expect(meritList.propose(3, [1, 2], { 1: 0, 2: 0 }, 9)).rejects.toMatchObject({ status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('refuses a "Hold" ranked above a "Shortlist"', async () => {
    prisma.application.findMany.mockResolvedValue([interviewed(1, { recommendation: 'Hold' }), interviewed(2)]);
    await expect(meritList.propose(3, [1, 2], { 1: 0, 2: 0 }, 9)).rejects.toMatchObject({ status: 422 });
  });

  test('409s when a candidate changed since the client loaded the board', async () => {
    prisma.application.findMany.mockResolvedValue([interviewed(1, { rankVersion: 2 })]);
    await expect(meritList.propose(3, [1], { 1: 1 }, 9)).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('409s once an offer has been made from the list', async () => {
    prisma.application.findMany.mockResolvedValue([
      interviewed(1),
      { ...interviewed(2), status: 'Offered', offer: { id: 5, status: 'Approved' } }
    ]);
    await expect(meritList.propose(3, [1], { 1: 0 }, 9)).rejects.toMatchObject({ status: 409 });
  });

  test('400s for an application on another vacancy', async () => {
    prisma.application.findMany.mockResolvedValue([interviewed(1)]);
    await expect(meritList.propose(3, [1, 77], { 1: 0, 77: 0 }, 9)).rejects.toMatchObject({ status: 400 });
  });
});

describe('approve', () => {
  test('approves every proposed entry in one step', async () => {
    prisma.application.findMany.mockResolvedValue([
      { id: 1, meritProposedById: 9, meritListStatus: 'Primary' },
      { id: 2, meritProposedById: 9, meritListStatus: 'Reserve' }
    ]);
    prisma.application.updateMany.mockResolvedValue({ count: 2 });

    const result = await meritList.approve(3, 12);

    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { vacancyId: 3, meritStatus: 'Proposed' },
      data: { meritStatus: 'Approved', meritApprovedAt: expect.any(Date), meritApprovedById: 12 }
    });
    expect(result).toEqual({ approvedCount: 2, primaryCount: 1 });
  });

  test('blocks the proposer from approving their own merit list', async () => {
    prisma.application.findMany.mockResolvedValue([{ id: 1, meritProposedById: 9, meritListStatus: 'Primary' }]);
    await expect(meritList.approve(3, 9)).rejects.toMatchObject({ status: 422 });
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  test('422s when nothing is awaiting approval', async () => {
    prisma.application.findMany.mockResolvedValue([]);
    await expect(meritList.approve(3, 12)).rejects.toMatchObject({ status: 422 });
  });

  describe('approves only the list the approver reviewed', () => {
    const proposed = [
      { id: 1, meritProposedById: 9, meritListStatus: 'Primary', rankVersion: 4 },
      { id: 2, meritProposedById: 9, meritListStatus: 'Reserve', rankVersion: 2 }
    ];

    test.each([
      ['re-proposed since (a version moved on)', { 1: 4, 2: 1 }],
      ['someone added since', { 1: 4 }],
      ['someone dropped since', { 1: 4, 2: 2, 3: 1 }]
    ])('refuses a list %s', async (_, seen) => {
      prisma.application.findMany.mockResolvedValue(proposed);
      await expect(meritList.approve(3, 12, seen)).rejects.toMatchObject({ status: 409, code: 'MERIT_LIST_CHANGED' });
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
    });

    test('approves each entry at the version seen, in one transaction', async () => {
      prisma.application.findMany.mockResolvedValue(proposed);
      prisma.application.updateMany.mockResolvedValue({ count: 1 });

      const result = await meritList.approve(3, 12, { 1: 4, 2: 2 });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.application.updateMany).toHaveBeenCalledWith({
        where: { id: 2, vacancyId: 3, meritStatus: 'Proposed', rankVersion: 2 }, data: expect.objectContaining({ meritStatus: 'Approved' })
      });
      expect(result).toEqual({ approvedCount: 2, primaryCount: 1 });
    });

    test('an entry changed between the check and the write fails the whole approval', async () => {
      prisma.application.findMany.mockResolvedValue(proposed);
      prisma.application.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      await expect(meritList.approve(3, 12, { 1: 4, 2: 2 })).rejects.toMatchObject({ status: 409, code: 'MERIT_LIST_CHANGED' });
    });
  });
});

describe('meritListController', () => {
  test('propose validates the body before touching the database', async () => {
    const res = mockRes();
    await meritListController.propose({ params: { vacancyId: '3' }, body: { applicationIds: [1, 1], applicationRankVersions: {} }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.application.findMany).not.toHaveBeenCalled();
  });

  test('propose notifies every Principal HR Officer', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, jobRef: 'REF', title: 'ATC', positionsRequired: 1 });
    prisma.application.findMany.mockResolvedValue([interviewed(1)]);
    prisma.application.update.mockResolvedValue({ id: 1 });
    prisma.staffUser.findMany.mockResolvedValue([{ id: 40 }]);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 40, email: 'phro@example.test' });
    prisma.notification.create.mockResolvedValue({});
    const res = mockRes();

    await meritListController.propose({ params: { vacancyId: '3' }, body: { applicationIds: [1], applicationRankVersions: { 1: 0 } }, user: { id: 9 } }, res);

    expect(prisma.staffUser.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'Principal_HR_Officer', active: true } }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ primaryCount: 1, reserveCount: 0 }));
  });

  test('approve reports a self-approval as 422', async () => {
    prisma.application.findMany.mockResolvedValue([{ id: 1, meritProposedById: 9, meritListStatus: 'Primary' }]);
    const res = mockRes();
    await meritListController.approve({ params: { vacancyId: '3' }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('rejects an invalid vacancy id', async () => {
    const res = mockRes();
    await meritListController.getBoard({ params: { vacancyId: 'abc' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
