const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/config/db', () => require('./__mocks__/db'));
const prisma = require('../src/config/db');
const { run, GRACE_MS } = require('../scripts/cleanupRequisitionUploads');

const NOW = new Date('2026-10-03T12:00:00Z');
let dir;
const name = (n) => `requisition-00000000-0000-0000-0000-${String(n).padStart(12, '0')}.docx`;

function file(filename, ageMs) {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, 'x');
  const t = new Date(NOW.getTime() - ageMs);
  fs.utimesSync(p, t, t);
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-cleanup-'));
  process.env.UPLOAD_DIR = dir;
  prisma.vacancy.findMany.mockResolvedValue([{ requisitionDocumentUrl: `/api/files/${name(1)}` }]);
  prisma.vacancyDraft.findMany.mockResolvedValue([{ requisitionFilename: name(2) }]);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('removes old requisition uploads nothing refers to, and keeps the rest', async () => {
  const old = GRACE_MS + 60000;
  file(name(1), old); // a vacancy's requisition
  file(name(2), old); // a draft's requisition
  file(name(3), old); // abandoned
  file(name(4), 60000); // just uploaded - its listing may still be in progress
  file('3f2c9a1e-cv.pdf', old); // not a requisition upload at all

  const message = await run(NOW);

  expect(fs.readdirSync(dir).sort()).toEqual(['3f2c9a1e-cv.pdf', name(1), name(2), name(4)].sort());
  expect(message).toMatch(/1 unused upload\(s\) removed, 3 kept/);
});

test('copes with no upload folder yet', async () => {
  process.env.UPLOAD_DIR = path.join(dir, 'missing');
  await expect(run(NOW)).resolves.toMatch(/No upload folder/);
});
