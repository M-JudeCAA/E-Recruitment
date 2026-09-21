const { broadcastDashboardEvent } = require('../src/realtime/dashboardSocket');

describe('broadcastDashboardEvent', () => {
  test('no-ops safely when init() was never called (e.g. under Jest)', () => {
    expect(() => broadcastDashboardEvent('VacancyApproved', { id: 1 })).not.toThrow();
  });
});
