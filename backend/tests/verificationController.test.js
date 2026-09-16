jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const verificationController = require('../src/controllers/verificationController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('verify', () => {
  test('rejects a non-numeric candidate id', async () => {
    const req = { params: { candidateId: 'abc' }, body: { decision: 'HR_Verified', comments: 'x'.repeat(20) } };
    const res = mockRes();

    await verificationController.verify(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test.each(['Pending', 'NotARealDecision', undefined])('rejects an invalid decision (%p)', async (decision) => {
    const req = { params: { candidateId: '5' }, body: { decision, comments: 'x'.repeat(20) } };
    const res = mockRes();

    await verificationController.verify(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test('rejects when neither sufficient comments nor a document are provided', async () => {
    const req = { params: { candidateId: '5' }, body: { decision: 'HR_Verified', comments: 'too short' } };
    const res = mockRes();

    await verificationController.verify(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test('returns 404 when the candidate has no internal profile at all', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue(null);
    const req = { params: { candidateId: '5' }, body: { decision: 'HR_Verified', comments: 'x'.repeat(20) } };
    const res = mockRes();

    await verificationController.verify(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.internalProfile.update).not.toHaveBeenCalled();
  });

  test('verifies with sufficient comments and no document', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue({ candidateId: 5 });
    prisma.internalProfile.update.mockResolvedValue({ candidateId: 5, verificationStatus: 'HR_Verified' });
    const req = {
      params: { candidateId: '5' },
      body: { decision: 'HR_Verified', comments: 'Confirmed employment directly with the supervisor.' },
      user: { id: 9 }
    };
    const res = mockRes();

    await verificationController.verify(req, res);

    expect(prisma.internalProfile.update).toHaveBeenCalledWith({
      where: { candidateId: 5 },
      data: expect.objectContaining({
        verificationStatus: 'HR_Verified', verificationEvidenceType: 'Comments', verifiedById: 9
      })
    });
    expect(res.json).toHaveBeenCalled();
  });

  test('accepts a Discrepancy_Flagged decision backed by a document, with no comments required', async () => {
    prisma.internalProfile.findUnique.mockResolvedValue({ candidateId: 5 });
    prisma.internalProfile.update.mockResolvedValue({ candidateId: 5, verificationStatus: 'Discrepancy_Flagged' });
    const req = {
      params: { candidateId: '5' },
      body: { decision: 'Discrepancy_Flagged' },
      file: { filename: 'letter.pdf' },
      user: { id: 9 }
    };
    const res = mockRes();

    await verificationController.verify(req, res);

    expect(prisma.internalProfile.update).toHaveBeenCalledWith({
      where: { candidateId: 5 },
      data: expect.objectContaining({ verificationEvidenceType: 'ManagerRecommendationLetter' })
    });
  });
});
