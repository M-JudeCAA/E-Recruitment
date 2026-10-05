jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const controller = require('../src/controllers/vacancyDraftController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
}

const FILE = 'requisition-11111111-1111-1111-1111-111111111111.docx';
const requisition = { document: { filename: FILE, originalName: 'Job Opening Request.docx' }, fields: { jobTitle: { value: 'HR Analyst' } } };
const user = { id: 4, type: 'staff' };

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  test('saves the form and the requisition, titled from the job title read off it', async () => {
    prisma.vacancyDraft.create.mockResolvedValue({ id: 9 });
    const res = mockRes();
    await controller.create({ body: { form: { salaryScale: 'U5' }, requisition }, user }, res);
    expect(prisma.vacancyDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        form: { salaryScale: 'U5' }, requisition, requisitionFilename: FILE, title: 'HR Analyst', createdById: 4,
        signedCopy: expect.anything(), signedCopyFilename: null
      }
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('keeps the signed copy, so the cleanup job leaves its upload alone', async () => {
    const signedCopy = { filename: 'requisition-signed-22222222-2222-2222-2222-222222222222.png', originalName: 'Signed.png' };
    await controller.create({ body: { form: {}, requisition, signedCopy }, user }, mockRes());
    expect(prisma.vacancyDraft.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      signedCopy, signedCopyFilename: signedCopy.filename
    }));
  });

  test.each([
    [{ requisition }, 'form must be an object'],
    [{ form: [] }, 'form must be an object'],
    [{ form: {}, requisition: { document: { filename: '../../etc/passwd' } } }, 'not a requisition'],
    [{ form: {}, signedCopy: { filename: FILE } }, 'not a signed requisition'],
    [{ form: { jobPurpose: 'x'.repeat(100 * 1024) } }, 'too large']
  ])('refuses a malformed draft (%#)', async (body, message) => {
    const res = mockRes();
    await controller.create({ body, user }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(message);
    expect(prisma.vacancyDraft.create).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  const base = '2026-10-03T09:00:00.000Z';

  test('saves over the version the caller loaded', async () => {
    prisma.vacancyDraft.updateMany.mockResolvedValue({ count: 1 });
    prisma.vacancyDraft.findFirst.mockResolvedValue({ id: 9, title: 'HR Analyst', updatedAt: new Date('2026-10-03T09:05:00Z') });
    const res = mockRes();
    await controller.update({ params: { id: '9' }, body: { form: {}, requisition, baseUpdatedAt: base }, user }, res);
    expect(prisma.vacancyDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, createdById: 4, updatedAt: new Date(base) }
    }));
    expect(res.json).toHaveBeenCalledWith({ id: 9, title: 'HR Analyst', updatedAt: new Date('2026-10-03T09:05:00Z') });
  });

  test('refuses to overwrite a save made from another window', async () => {
    prisma.vacancyDraft.updateMany.mockResolvedValue({ count: 0 });
    prisma.vacancyDraft.findFirst.mockResolvedValue({ id: 9 });
    const res = mockRes();
    await controller.update({ params: { id: '9' }, body: { form: {}, baseUpdatedAt: base }, user }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DRAFT_CHANGED' }));
  });

  test("someone else's draft is simply not found", async () => {
    prisma.vacancyDraft.updateMany.mockResolvedValue({ count: 0 });
    prisma.vacancyDraft.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await controller.update({ params: { id: '9' }, body: { form: {}, baseUpdatedAt: base }, user }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

test('get and delete are limited to the owner', async () => {
  prisma.vacancyDraft.findFirst.mockResolvedValue(null);
  const res = mockRes();
  await controller.get({ params: { id: '9' }, user }, res);
  expect(prisma.vacancyDraft.findFirst).toHaveBeenCalledWith({ where: { id: 9, createdById: 4 } });
  expect(res.status).toHaveBeenCalledWith(404);

  prisma.vacancyDraft.deleteMany.mockResolvedValue({ count: 1 });
  const del = mockRes();
  await controller.remove({ params: { id: '9' }, user }, del);
  expect(prisma.vacancyDraft.deleteMany).toHaveBeenCalledWith({ where: { id: 9, createdById: 4 } });
  expect(del.status).toHaveBeenCalledWith(204);
});
