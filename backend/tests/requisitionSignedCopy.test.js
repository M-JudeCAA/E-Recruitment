jest.mock('../src/config/db', () => require('./__mocks__/db'));

const fs = require('fs');
const os = require('os');
const path = require('path');
const prisma = require('../src/config/db');

// Replacing a vacancy's signed requisition copy: anyone in HR before
// approval, a Senior HR Officer+ with a reason after, every change kept.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signed-copy-'));
process.env.UPLOAD_DIR = dir;
const signedCopies = require('../src/services/requisitionSignedCopyService');

const NEW_FILE = 'requisition-signed-11111111-2222-3333-4444-555555555555.pdf';
const upload = () => {
  fs.writeFileSync(path.join(dir, NEW_FILE), 'new scan');
  return { filename: NEW_FILE, originalname: 'signed again.pdf' };
};
const vacancy = (overrides = {}) => ({
  id: 5, status: 'PendingApproval', approvedAt: null, createdById: 12,
  requisitionSignedCopyUrl: '/api/files/requisition-signed-old.pdf', requisitionSignedCopyName: 'signed.pdf',
  requisitionDetails: { fields: {}, signedCopy: { hash: 'oldhash' } }, ...overrides
});
const req = (role, id = 7) => ({ user: { id, role, type: 'staff' } });
const stillThere = () => fs.existsSync(path.join(dir, NEW_FILE));

beforeEach(() => {
  jest.clearAllMocks();
  prisma.vacancy.updateMany.mockResolvedValue({ count: 1 });
  prisma.requisitionSignedCopyChange.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  prisma.delegation.findFirst.mockResolvedValue(null);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test('before approval, an HR Officer replaces it - no reason needed - and the change is kept', async () => {
  prisma.vacancy.findUnique.mockResolvedValue(vacancy());

  const change = await signedCopies.replace(req('HR_Officer'), 5, upload(), '');

  expect(prisma.vacancy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 5, requisitionSignedCopyUrl: '/api/files/requisition-signed-old.pdf' },
    data: expect.objectContaining({ requisitionSignedCopyUrl: `/api/files/${NEW_FILE}`, requisitionSignedCopyName: 'signed again.pdf' })
  }));
  expect(change).toMatchObject({
    vacancyId: 5, previousName: 'signed.pdf', previousHash: 'oldhash', newName: 'signed again.pdf', reason: null,
    afterApproval: false, changedById: 7, changedByRole: 'HR_Officer'
  });
  expect(change.newHash).toMatch(/^[0-9a-f]{64}$/);
  expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'Signed requisition copy replaced' }) }));
  expect(stillThere()).toBe(true);
});

test('after approval, an HR Officer is refused and the upload is removed', async () => {
  prisma.vacancy.findUnique.mockResolvedValue(vacancy({ status: 'Open', approvedAt: new Date() }));

  await expect(signedCopies.replace(req('HR_Officer'), 5, upload(), 'The scan was the wrong page')).rejects.toMatchObject({ code: 'SIGNED_COPY_NEEDS_SENIOR', status: 403 });
  expect(prisma.vacancy.updateMany).not.toHaveBeenCalled();
  expect(stillThere()).toBe(false);
});

test('after approval, a Senior HR Officer must say why', async () => {
  prisma.vacancy.findUnique.mockResolvedValue(vacancy({ status: 'Open', approvedAt: new Date() }));
  await expect(signedCopies.replace(req('Senior_HR_Officer'), 5, upload(), 'oops')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

  const change = await signedCopies.replace(req('Senior_HR_Officer'), 5, upload(), 'The first scan was missing page two');
  expect(change).toMatchObject({ afterApproval: true, reason: 'The first scan was missing page two', changedByRole: 'Senior_HR_Officer' });
});

test('a vacancy rejected before approval is final', async () => {
  prisma.vacancy.findUnique.mockResolvedValue(vacancy({ status: 'Rejected' }));
  await expect(signedCopies.replace(req('Director'), 5, upload(), 'A good long reason')).rejects.toMatchObject({ code: 'VACANCY_REJECTED' });
});

test('the same file again is not a replacement', async () => {
  const sameHash = require('crypto').createHash('sha256').update('new scan').digest('hex');
  prisma.vacancy.findUnique.mockResolvedValue(vacancy({ requisitionDetails: { signedCopy: { hash: sameHash } } }));
  await expect(signedCopies.replace(req('HR_Officer'), 5, upload(), '')).rejects.toMatchObject({ code: 'SAME_FILE' });
  expect(stillThere()).toBe(false);
});

test('two replacements at once: the second is refused rather than lost from the history', async () => {
  prisma.vacancy.findUnique.mockResolvedValue(vacancy());
  prisma.vacancy.updateMany.mockResolvedValue({ count: 0 });
  await expect(signedCopies.replace(req('HR_Officer'), 5, upload(), '')).rejects.toMatchObject({ code: 'SIGNED_COPY_CHANGED' });
  expect(prisma.requisitionSignedCopyChange.create).not.toHaveBeenCalled();
});

test('the history names who replaced it and whose delegation they used', async () => {
  prisma.requisitionSignedCopyChange.findMany.mockResolvedValue([
    { id: 2, newName: 'b.pdf', actingAsId: 4, changedBy: { name: 'Sam' } },
    { id: 1, newName: 'a.pdf', actingAsId: null, changedBy: { name: 'Hope' } }
  ]);
  prisma.staffUser.findMany.mockResolvedValue([{ id: 4, name: 'Pat PHRO' }]);
  expect(await signedCopies.history(5)).toEqual([
    { id: 2, newName: 'b.pdf', changedBy: { name: 'Sam' }, actingFor: 'Pat PHRO' },
    { id: 1, newName: 'a.pdf', changedBy: { name: 'Hope' }, actingFor: null }
  ]);
});
