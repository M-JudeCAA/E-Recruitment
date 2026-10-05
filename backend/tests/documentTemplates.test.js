jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const templates = require('../src/services/templateService');
const documents = require('../src/services/documentService');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.documentTemplate.findUnique.mockResolvedValue(null);
});

test('every default template uses only the placeholders it offers', () => {
  for (const [key, def] of Object.entries(templates.DEFAULTS)) {
    expect([key, templates.unknownPlaceholders(key, def.body)]).toEqual([key, []]);
  }
});

test('placeholders are filled and escaped; blocks go in as built; unknown ones stay visible', () => {
  const html = templates.fill('regretLetter', '<p>{{candidateName}} - {{ jobTitle }} - {{nope}} - {{candidateAddress}}</p>', {
    candidateName: 'Ann <b>B</b>', jobTitle: 'ATC'
  });
  expect(html).toBe('<p>Ann &lt;b&gt;B&lt;/b&gt; - ATC - {{nope}} - </p>');
  expect(templates.fill('offerLetter', '{{conditionsList}}', { conditionsList: '<ul><li>x</li></ul>' })).toBe('<ul><li>x</li></ul>');
});

test('HR\'s version replaces the default, sanitised, and reset brings the default back', async () => {
  prisma.documentTemplate.findUnique.mockResolvedValueOnce(null);
  await templates.save('regretLetter', '<p onclick="x()">Dear {{candidateName}}</p><script>alert(1)</script>', 4);
  expect(prisma.documentTemplate.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { key: 'regretLetter' }, create: { key: 'regretLetter', body: '<p>Dear {{candidateName}}</p>', updatedById: 4 }
  }));
  prisma.documentTemplate.findUnique.mockResolvedValue({ key: 'regretLetter', body: '<p>Mine {{candidateName}}</p>', updatedAt: new Date() });
  expect((await templates.render('regretLetter', { candidateName: 'Ann' })).html).toBe('<p>Mine Ann</p>');
  await templates.reset('regretLetter');
  expect(prisma.documentTemplate.deleteMany).toHaveBeenCalledWith({ where: { key: 'regretLetter' } });
  await expect(templates.get('nope')).rejects.toMatchObject({ status: 404 });
});

test('the offer letter is filled from the offer, its candidate and vacancy', async () => {
  prisma.offer.findUnique.mockResolvedValue({
    id: 9, status: 'Approved', salaryAmount: 4500000, salaryCurrency: 'UGX', salaryPeriod: 'Monthly', allowances: null,
    employmentCategory: 'Contract', contractMonths: 24, startDate: new Date('2026-12-01T00:00:00Z'), dutyStation: null,
    responseDeadline: new Date('2026-11-01T00:00:00Z'), conditions: ['Medical fitness <certificate>'],
    application: {
      id: 3, vacancyId: 7, candidateId: 5,
      candidate: { fullName: 'Jane Achieng', location: 'Entebbe' },
      vacancy: { title: 'ATC Officer', jobRef: 'UCAA/ADV/EXT/001/2026', location: 'Entebbe International Airport', department: { name: 'ATM' } }
    }
  });
  const doc = await documents.offerLetter(9);
  expect(doc).toEqual(expect.objectContaining({ vacancyId: 7, applicationId: 3, candidateIds: [5] }));
  expect(doc.title).toBe('Offer of employment - Jane Achieng - ATC Officer');
  expect(doc.html).toContain('OFFER OF EMPLOYMENT AS ATC Officer (UCAA/ADV/EXT/001/2026)');
  expect(doc.html).toContain('UGX 4,500,000');
  expect(doc.html).toContain('on contract for 24 months');
  expect(doc.html).toContain('Entebbe International Airport');
  expect(doc.html).toContain('<li>Medical fitness &lt;certificate&gt;</li>');
  expect(doc.html).toContain('1 November 2026');
});

test('the appointing instrument waits for the acceptance; a regret letter for a rejection', async () => {
  prisma.offer.findUnique.mockResolvedValue({ id: 9, status: 'Approved', salaryAmount: 1, application: {} });
  await expect(documents.appointmentInstrument(9)).rejects.toMatchObject({ status: 422 });
  prisma.application.findUnique.mockResolvedValue({ id: 3, status: 'Interviewed', candidate: {}, vacancy: {} });
  await expect(documents.regretLetter(3)).rejects.toMatchObject({ status: 422 });
});
