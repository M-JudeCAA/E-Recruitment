jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const exportController = require('../src/controllers/exportController');

const mockRes = () => {
  const res = { headers: {} };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
  res.send = jest.fn(() => res);
  return res;
};
const staff = { type: 'staff', id: 5, role: 'HR_Officer' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.application.findMany.mockResolvedValue([]); // no conflicts
});

describe('offers export', () => {
  test('writes every offer as a CSV row, with formula-looking text neutralised', async () => {
    prisma.offer.findMany.mockResolvedValue([{
      status: 'Approved', salaryAmount: '3100000', salaryCurrency: 'UGX', salaryPeriod: 'Monthly', approvedDate: new Date('2026-09-03'),
      application: { meritRank: 3, meritListStatus: 'Primary', candidate: { id: 9, fullName: '=Henry', candidateType: 'External' }, vacancy: { jobRef: 'UCAA/ADV/EXT/002/2026', title: 'Fire Officer' } }
    }]);
    prisma.offer.count.mockResolvedValue(1);
    prisma.offer.groupBy.mockResolvedValue([]);
    const res = mockRes();
    await exportController.offers({ user: staff, query: {} }, res);
    const csv = res.send.mock.calls[0][0];
    expect(res.headers['Content-Type']).toMatch(/text\/csv/);
    expect(csv).toMatch(/Candidate,Candidate type,Job reference/);
    expect(csv).toMatch(/'=Henry,External,UCAA\/ADV\/EXT\/002\/2026,Fire Officer,3,Primary,Approved,3100000,UGX,month/);
  });

  test('refuses an unknown status filter', async () => {
    const res = mockRes();
    await exportController.offers({ user: staff, query: { status: 'Nope' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('hires export', () => {
  test('lists onboarding cases', async () => {
    prisma.hire.findMany.mockResolvedValue([{
      caseRef: 'UCAA/ONB/001/2026', hiredAt: new Date('2026-10-05'), handoffStatus: 'NotConfigured', candidateId: 4,
      hiredBy: { name: 'Brian' }, application: { candidate: { fullName: 'Emmanuel Kato' }, vacancy: { jobRef: 'UCAA/ADV/EXT/001/2026', title: 'Senior Accountant' } }
    }]);
    const res = mockRes();
    await exportController.hires({ user: staff, query: {} }, res);
    expect(res.send.mock.calls[0][0]).toMatch(/UCAA\/ONB\/001\/2026,Emmanuel Kato,UCAA\/ADV\/EXT\/001\/2026,Senior Accountant,2026-10-05,Brian,NotConfigured/);
  });
});
