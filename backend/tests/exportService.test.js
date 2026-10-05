jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const { cell, toCsv, fileSlug } = require('../src/utils/csv');
const exportService = require('../src/services/exportService');
const exportController = require('../src/controllers/exportController');

beforeEach(() => jest.clearAllMocks());

describe('csv', () => {
  test('quotes commas, quotes and line breaks', () => {
    expect(cell('Okello, James')).toBe('"Okello, James"');
    expect(cell('He said "yes"')).toBe('"He said ""yes"""');
    expect(cell('two\nlines')).toBe('"two\nlines"');
  });

  test('neutralises text a spreadsheet would run as a formula, but not real numbers', () => {
    expect(cell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(cell('+256700000000')).toBe("'+256700000000");
    expect(cell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(cell(-4.5)).toBe('-4.5');
  });

  test('writes a BOM, a header row and CRLF line ends; blanks for null', () => {
    const csv = toCsv([{ header: 'A', value: (r) => r.a }, { header: 'B', value: (r) => r.b }], [{ a: 1, b: null }]);
    expect(csv).toBe('﻿A,B\r\n1,\r\n');
  });

  test('makes a job reference safe for a filename', () => {
    expect(fileSlug('UCAA/ADV/EXT/007/2026')).toBe('UCAA-ADV-EXT-007-2026');
  });
});

describe('shortlistReport', () => {
  const candidate = (fullName) => ({ fullName, email: `${fullName}@x.test`, phone: null, candidateType: 'External', districtOfOrigin: 'Gulu', location: 'Kampala' });

  test('lists every submitted applicant, committee rank first, then interview order, then screening score', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, jobRef: 'UCAA/ADV/EXT/007/2026', title: 'Accountant' });
    prisma.application.findMany.mockResolvedValue([
      { candidate: candidate('Cara'), shortlistScore: 90, status: 'UnderReview', screeningPassed: true, screeningReasons: '[]' },
      { candidate: candidate('Abel'), committeeRank: 2, status: 'ShortlistProposed', screeningPassed: true },
      { candidate: candidate('Bea'), committeeRank: 1, committeeBand: 'Unanimous', committeeAgreement: 0.875, status: 'ShortlistProposed', screeningPassed: true },
      { candidate: candidate('Dan'), shortlistScore: 40, status: 'Rejected', screeningPassed: false, screeningReasons: '["No degree","Too young"]', rejectionReason: 'Not qualified' }
    ]);

    const report = await exportService.shortlistReport(3);

    expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vacancyId: 3, status: { not: 'Draft' } } }));
    expect(report.filename).toBe('shortlisting-report-UCAA-ADV-EXT-007-2026.csv');
    const lines = report.csv.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines.slice(1).map((l) => l.split(',')[5])).toEqual(['Bea', 'Abel', 'Cara', 'Dan']);
    expect(lines[1]).toContain('Unanimous');
    expect(lines[1]).toContain(',88,'); // agreement as a percentage
    expect(lines[4]).toContain('Does not meet,No degree; Too young');
  });

  test('404s for an unknown vacancy', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    await expect(exportService.shortlistReport(9)).rejects.toMatchObject({ status: 404 });
  });
});

describe('exportController', () => {
  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
  }

  test('sends the CSV as a download and records the export in the vacancy history', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 3, jobRef: 'UCAA/ADV/EXT/007/2026', title: 'Accountant' });
    prisma.application.findMany.mockResolvedValue([]);
    const res = mockRes();

    await exportController.shortlistReport({ params: { id: '3' }, user: { type: 'staff', id: 4 } }, res);

    expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="shortlisting-report-UCAA-ADV-EXT-007-2026.csv"');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Committee rank'));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'Vacancy', entityId: 3, action: 'Shortlisting report exported', performedById: 4, payload: { rows: 0 }
    }) });
  });

  test('refuses a malformed id', async () => {
    const res = mockRes();
    await exportController.meritList({ params: { vacancyId: 'abc' }, user: { type: 'staff', id: 4 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
