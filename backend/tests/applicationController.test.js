jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const applicationController = require('../src/controllers/applicationController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
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

  test('creates a Recommended offer and moves the application to Offered once a recommendation is finalized', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1,
      interviewRounds: [{ id: 1, score: 78, recommendation: 'Shortlist' }]
    });
    prisma.offer.create.mockResolvedValue({ id: 10, applicationId: 1, status: 'Recommended' });

    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(prisma.offer.create).toHaveBeenCalledWith({
      data: { applicationId: 1, status: 'Recommended', recommendedById: 5 }
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { status: 'Offered' }
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('returns 409 rather than a duplicate offer if one was already recommended', async () => {
    prisma.application.findUnique.mockResolvedValue({
      id: 1,
      interviewRounds: [{ id: 1, score: 78, recommendation: 'Shortlist' }]
    });
    prisma.offer.create.mockRejectedValue(new Error('Unique constraint failed'));

    const req = { params: { id: '1' }, user: { id: 5 } };
    const res = mockRes();

    await applicationController.recommendOffer(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
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
