jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/realtime/dashboardSocket', () => ({
  isRunning: jest.fn(() => true),
  hasClients: jest.fn(() => true),
  broadcastDashboardEvent: jest.fn(),
  sendToStaff: jest.fn(),
  sendToCandidates: jest.fn(),
  broadcastToCandidates: jest.fn()
}));
jest.mock('../src/utils/dashboardSignal', () => ({ signalDashboards: jest.fn(() => Promise.resolve(true)) }));

const prisma = require('../src/config/db');
const socket = require('../src/realtime/dashboardSocket');
const { signalDashboards } = require('../src/utils/dashboardSignal');
const live = require('../src/services/liveUpdateService');

beforeEach(() => {
  jest.clearAllMocks();
  socket.isRunning.mockReturnValue(true);
  socket.hasClients.mockReturnValue(true);
});

describe('afterAudit', () => {
  test('tells every staff page what changed and who changed it', async () => {
    prisma.staffUser.findUnique.mockResolvedValue({ name: 'Grace A.' });
    await live.afterAudit({ entityType: 'Offer', entityId: 5, action: 'Offer approved', performedById: 3 });
    expect(socket.broadcastDashboardEvent).toHaveBeenCalledWith('Changed', { entityType: 'Offer', entityId: 5, action: 'Offer approved', by: 'Grace A.' });
  });

  test('tells the candidate a change to their application is theirs', async () => {
    prisma.application.findUnique.mockResolvedValue({ candidateId: 42 });
    await live.afterAudit({ entityType: 'Application', entityId: 9, action: 'Shortlisted' });
    expect(socket.sendToCandidates).toHaveBeenCalledWith([42], 'Changed', { entityType: 'Application', entityId: 9 });
  });

  test('an employment check is audited under the candidate', async () => {
    await live.afterAudit({ entityType: 'InternalProfile', entityId: 42, action: 'Employment verified' });
    expect(socket.sendToCandidates).toHaveBeenCalledWith([42], 'Changed', expect.any(Object));
  });

  test('a vacancy change refreshes every candidate job list', async () => {
    await live.afterAudit({ entityType: 'Vacancy', entityId: 1, action: 'Approved' });
    expect(socket.broadcastToCandidates).toHaveBeenCalledWith('JobsChanged', { vacancyId: 1 });
  });

  test('looks nothing up when no page is listening', async () => {
    socket.hasClients.mockReturnValue(false);
    await live.afterAudit({ entityType: 'Application', entityId: 9, action: 'Shortlisted', performedById: 3 });
    expect(prisma.staffUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.application.findUnique).not.toHaveBeenCalled();
  });

  test('in the scheduler worker the signal goes through the API, with its targets', async () => {
    socket.isRunning.mockReturnValue(false);
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      prisma.application.findUnique.mockResolvedValue({ candidateId: 42 });
      await live.afterAudit({ entityType: 'Application', entityId: 9, action: 'Offer expired' });
    } finally {
      process.env.NODE_ENV = env;
    }
    expect(signalDashboards).toHaveBeenCalledWith('Changed', expect.objectContaining({ _to: expect.objectContaining({ allStaff: true }) }));
    expect(signalDashboards).toHaveBeenCalledWith('Changed', expect.objectContaining({ _to: expect.objectContaining({ candidateIds: [42] }) }));
    expect(socket.broadcastDashboardEvent).not.toHaveBeenCalled();
  });
});

describe('deliverRelayed', () => {
  test('routes a relayed signal to who it names', () => {
    live.deliverRelayed('NotificationsChanged', { type: 'OfferExpired', _to: { candidateIds: [42] } });
    expect(socket.sendToCandidates).toHaveBeenCalledWith([42], 'NotificationsChanged', { type: 'OfferExpired' });
    expect(socket.broadcastDashboardEvent).not.toHaveBeenCalled();
  });

  test('a plain dashboard signal still reaches every staff page', () => {
    live.deliverRelayed('MaintenanceRun', { jobs: 3 });
    expect(socket.broadcastDashboardEvent).toHaveBeenCalledWith('MaintenanceRun', { jobs: 3 });
  });
});

describe('new notices', () => {
  test('ring the recipient only', () => {
    live.noticeForStaff(7);
    live.noticeForCandidate(42, 'OfferReceived');
    expect(socket.sendToStaff).toHaveBeenCalledWith([7], 'NotificationsChanged', {});
    expect(socket.sendToCandidates).toHaveBeenCalledWith([42], 'NotificationsChanged', { type: 'OfferReceived' });
  });
});
