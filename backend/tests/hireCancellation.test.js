jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../src/utils/uploadFiles', () => ({ ...jest.requireActual('../src/utils/uploadFiles'), removeUploads: jest.fn() }));

const prisma = require('../src/config/db');
const hireController = require('../src/controllers/hireController');
const { removeUploads } = require('../src/utils/uploadFiles');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const hire = {
  id: 6, offerId: 20, applicationId: 30, vacancyId: 4, positionId: 100, caseRef: 'UCAA/ONB/001/2026', hiredAt: new Date(), hiredById: 3,
  signedInstrumentUrl: '/api/files/appointment-signed-abc.pdf', handoffStatus: 'NotConfigured', onboardingCaseId: null,
  package: { person: { fullName: 'Jane Doe' } }
};
const call = async (body = { reason: 'She never took up the post' }) => {
  const res = mockRes();
  await hireController.cancel({ params: { offerId: '20' }, body, user: { id: 8 } }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.hire.findUnique.mockResolvedValue(hire);
  prisma.hire.deleteMany.mockResolvedValue({ count: 1 });
  prisma.vacancy.findUnique.mockResolvedValue(null);
});

describe('cancelling a hire', () => {
  test('removes the case, frees the post on the position and keeps the record in the history', async () => {
    const res = await call();
    expect(prisma.hire.deleteMany).toHaveBeenCalledWith({ where: { id: 6 } });
    expect(prisma.position.updateMany).toHaveBeenCalledWith({
      where: { id: 100, headcount: { not: null }, occupied: { gt: 0 } }, data: { occupied: { decrement: 1 } }
    });
    expect(removeUploads).toHaveBeenCalledWith('/api/files/appointment-signed-abc.pdf');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'Offer', entityId: 20, action: 'Hire cancelled', performedById: 8,
      payload: expect.objectContaining({ caseRef: 'UCAA/ONB/001/2026', comment: 'She never took up the post' })
    }) });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true, hrisHasCase: false }));
  });

  test('warns when the HRIS already has the case', async () => {
    prisma.hire.findUnique.mockResolvedValue({ ...hire, handoffStatus: 'Sent', onboardingCaseId: 'HRIS-77' });
    const res = await call();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hrisHasCase: true, onboardingCaseId: 'HRIS-77', warning: expect.stringMatching(/HRIS/) }));
  });

  test('needs a reason, and a hire to cancel', async () => {
    let res = await call({ reason: 'oops' });
    expect(res.status).toHaveBeenCalledWith(400);
    prisma.hire.findUnique.mockResolvedValue(null);
    res = await call();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hire.deleteMany).not.toHaveBeenCalled();
  });

  test('two people cancelling at once: the post is taken off the count once', async () => {
    prisma.hire.deleteMany.mockResolvedValue({ count: 0 });
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.position.updateMany).not.toHaveBeenCalled();
  });
});
