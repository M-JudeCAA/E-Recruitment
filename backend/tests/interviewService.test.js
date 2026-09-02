jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const interviewService = require('../src/services/interviewService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recordPanelScore', () => {
  test('records the score against the panel member with the recording HR Officer attributed', async () => {
    prisma.panelMember.update.mockResolvedValue({
      id: 1, interviewRoundId: 10, score: 85, comments: 'Strong technical answers', recordedById: 3
    });
    prisma.panelMember.findMany.mockResolvedValue([
      { id: 1, score: 85 }
    ]);

    await interviewService.recordPanelScore(1, { score: 85, comments: 'Strong technical answers' }, 3);

    expect(prisma.panelMember.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ score: 85, comments: 'Strong technical answers', recordedById: 3 })
    });
  });

  test('recomputes the round score as the average across all scored panelists', async () => {
    prisma.panelMember.update.mockResolvedValue({ id: 2, interviewRoundId: 10 });
    prisma.panelMember.findMany.mockResolvedValue([
      { id: 1, score: 80 },
      { id: 2, score: 90 },
      { id: 3, score: null } // not yet scored - excluded from the average
    ]);

    await interviewService.recordPanelScore(2, { score: 90, comments: '' }, 3);

    expect(prisma.interviewRound.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { score: 85 } // average of 80 and 90, excluding the unscored panelist
    });
  });

  test('sets the round score to null if no panelist has been scored yet', async () => {
    prisma.panelMember.update.mockResolvedValue({ id: 1, interviewRoundId: 10 });
    prisma.panelMember.findMany.mockResolvedValue([
      { id: 1, score: null },
      { id: 2, score: null }
    ]);

    await interviewService.recordPanelScore(1, { score: null, comments: 'placeholder' }, 3);

    expect(prisma.interviewRound.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { score: null }
    });
  });
});
