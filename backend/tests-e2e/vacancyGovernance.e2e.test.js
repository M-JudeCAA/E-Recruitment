const request = require('supertest');
const {
  prisma, app, resetDatabase, createStaff, createOrg, staffToken, api, expectStatus, createVacancyFromRequisition, uploadRequisition,
  uploadSignedCopy
} = require('./helpers');

// Vacancy-level rules from the September 2026 UCAA requirements: job
// reference numbering (FR-ATS-023, BR-ATS-04).

let staff;
let tokens;
let org;

beforeEach(async () => {
  await resetDatabase();
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    manager: await createStaff('Manager', 'manager@caa.co.ug')
  };
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
  org = await createOrg(staff.hro.id);
});

function createVacancy(postingType = 'External') {
  return createVacancyFromRequisition(tokens.hro, {
    positionId: org.position.id, postingType, positionsRequired: 1,
    deadline: new Date(Date.now() + 14 * 86400000).toISOString()
  });
}

test('numbers job references per posting type and year, without gaps or reuse, even when created concurrently', async () => {
  const year = new Date().getFullYear();

  const results = await Promise.all(Array.from({ length: 6 }, () => createVacancy('External')));
  const refs = results.map((r) => expectStatus(r, 201).body.jobRef).sort();
  expect(refs).toEqual([1, 2, 3, 4, 5, 6].map((n) => `UCAA/ADV/EXT/00${n}/${year}`));

  // Internal adverts have their own sequence.
  expect(expectStatus(await createVacancy('Internal'), 201).body.jobRef).toBe(`UCAA/ADV/INT/001/${year}`);

  // A deleted vacancy's number is never handed out again.
  const last = await prisma.vacancy.findFirst({ where: { jobRef: `UCAA/ADV/EXT/006/${year}` } });
  await prisma.vacancy.delete({ where: { id: last.id } });
  expect(expectStatus(await createVacancy('External'), 201).body.jobRef).toBe(`UCAA/ADV/EXT/007/${year}`);
});

test('records who changed what on a vacancy, with before and after values (FR-ATS-012)', async () => {
  const vacancy = expectStatus(await createVacancy(), 201).body;
  expectStatus(await api(tokens.hro).patch(`/api/vacancies/${vacancy.id}`, { positionsRequired: 3, salaryScale: 'U4' }), 200);

  const history = expectStatus(await api(tokens.hro).get(`/api/audit/Vacancy/${vacancy.id}`), 200).body;
  expect(history.map((h) => h.action)).toEqual(['Vacancy edited', 'Vacancy created']);
  expect(history[0].performedBy.name).toContain('HR_Officer');
  expect(history[0].changes).toEqual({
    positionsRequired: { from: 1, to: 3 }, salaryScale: { from: null, to: 'U4' }
  });
});

test('an approver returns a vacancy with a comment; HR revises and resubmits it; a rejection is final (FR-ATS-009)', async () => {
  const vacancy = expectStatus(await createVacancy(), 201).body;

  // A comment is required, and the vacancy isn't approvable while returned.
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/return`, {})).status).toBe(400);
  const returned = expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/return`, { reason: 'Salary scale should be U4' }), 200).body;
  expect(returned).toEqual(expect.objectContaining({ status: 'Returned', returnReason: 'Salary scale should be U4' }));
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`)).status).toBe(422);
  const notice = await prisma.notification.findFirst({ where: { recipientId: staff.hro.id, taskType: 'VacancyReturned' } });
  expect(notice.message).toContain('Salary scale should be U4');

  // HR revises and resubmits; the approver can then approve it.
  expectStatus(await api(tokens.hro).patch(`/api/vacancies/${vacancy.id}`, { salaryScale: 'U4' }), 200);
  expectStatus(await api(tokens.hro).patch(`/api/vacancies/${vacancy.id}/resubmit`), 200);
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);

  const history = expectStatus(await api(tokens.hro).get(`/api/audit/Vacancy/${vacancy.id}`), 200).body;
  expect(history.map((h) => h.action)).toEqual([
    'Vacancy approved', 'Vacancy resubmitted for approval', 'Vacancy edited', 'Vacancy returned for revision', 'Vacancy created'
  ]);
  expect(history[3].comment).toBe('Salary scale should be U4');

  // Closing needs a reason; moving a published deadline needs one too.
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}`, { deadline: new Date(Date.now() + 30 * 86400000).toISOString() })).status).toBe(400);
  expect((await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/close`, {})).status).toBe(400);
  const closed = expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/close`, { reason: 'Position frozen' }), 200).body;
  expect(closed).toEqual(expect.objectContaining({ status: 'Closed', closeReason: 'Position frozen' }));

  // A rejected vacancy can't be resubmitted, approved or edited.
  const second = expectStatus(await createVacancy(), 201).body;
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${second.id}/reject`, { reason: 'Not in the approved establishment' }), 200);
  expect((await api(tokens.hro).patch(`/api/vacancies/${second.id}/resubmit`)).status).toBe(422);
  expect((await api(tokens.manager).patch(`/api/vacancies/${second.id}/approve`)).status).toBe(422);
  expect((await api(tokens.hro).patch(`/api/vacancies/${second.id}`, { salaryScale: 'U3' })).status).toBe(422);
});

describe('creating a vacancy from the EXCO-approved requisition', () => {
  const { createCandidate, candidateToken } = require('./helpers');
  const { buildRequisitionDocx, buildScannedPdf } = require('../scripts/lib/requisitionDocument');
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const upload = (buffer, filename, contentType) => request(app).post('/api/vacancies/requisition')
    .set('Authorization', `Bearer ${tokens.hro}`).attach('document', buffer, { filename, contentType });

  test('reads the document, pre-fills the form, and keeps the requisition with the vacancy', async () => {
    // Nothing is created without a requisition.
    const bare = await api(tokens.hro).post('/api/vacancies', { positionId: org.position.id, postingType: 'External' });
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe('REQUISITION_REQUIRED');

    const docx = await buildRequisitionDocx({ excoMinute: 'EXCO MIN 77/2026' });
    const read = expectStatus(await upload(docx, 'Job Opening Request - HR Analyst.docx', DOCX), 200).body;
    expect(read.organogram.department).toEqual(expect.objectContaining({ id: org.department.id, confidence: 'high' }));
    expect(read.organogram.position).toEqual(expect.objectContaining({ id: org.position.id, confidence: 'high' }));
    expect(read.prefill).toEqual(expect.objectContaining({
      departmentId: org.department.id, positionId: org.position.id, positionsRequired: 2, postingType: 'External', salaryScale: 'U5'
    }));
    // "Reports to: Manager Human Resources" isn't on this test organogram.
    expect(read.warnings.join(' ')).toMatch(/Manager Human Resources.*not on the organogram/);

    // HR confirms the EXCO approval, adds the signed scan and screening, and creates it.
    const form = { ...read.prefill, deadline: new Date(Date.now() + 14 * 86400000).toISOString(), minimumEducationLevel: 'Bachelors' };
    const unconfirmed = await api(tokens.hro).post('/api/vacancies', { ...form, requisitionDocument: read.document });
    expect(unconfirmed.body.code).toBe('REQUISITION_NOT_CONFIRMED');
    const unsigned = await api(tokens.hro).post('/api/vacancies', { ...form, requisitionDocument: read.document, requisitionConfirmed: true });
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.code).toBe('SIGNED_COPY_REQUIRED');
    const signedCopy = await uploadSignedCopy(tokens.hro);
    expect(signedCopy).toEqual(expect.objectContaining({ originalName: 'Signed requisition.pdf', filename: expect.stringMatching(/^requisition-signed-.*\.pdf$/) }));
    const vacancy = expectStatus(await api(tokens.hro).post('/api/vacancies', {
      ...form, requisitionDocument: read.document, requisitionSignedCopy: signedCopy, requisitionConfirmed: true
    }), 201).body;
    expect(vacancy).toEqual(expect.objectContaining({
      requisitionSignedCopyUrl: signedCopy.url, requisitionSignedCopyName: 'Signed requisition.pdf',
      requisitionDocumentUrl: read.document.url, requisitionDocumentName: 'Job Opening Request - HR Analyst.docx',
      salaryScale: 'U5', positionsRequired: 2, minimumEducationLevel: 'Bachelors',
      desirableQualifications: ['Membership of the Human Resource Managers Association of Uganda.']
    }));
    expect(vacancy.requisitionDetails.fields.excoReference.value).toBe('EXCO MIN 77/2026');
    expect(vacancy.requisitionDetails.editedFields).toEqual([]);

    // The same document can't open a second vacancy.
    const again = await upload(docx, 'copy.docx', DOCX);
    expect(again.status).toBe(409);
    expect(again.body).toEqual(expect.objectContaining({ code: 'DUPLICATE_REQUISITION', existingVacancy: expect.objectContaining({ id: vacancy.id }) }));

    // Staff can open the document and the scan; candidates never see either, or what was read.
    expectStatus(await api(tokens.hro).get(read.document.url), 200);
    expectStatus(await api(tokens.hro).get(signedCopy.url), 200);
    expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);
    const candidate = await createCandidate({ fullName: 'Grace Achieng', email: 'grace@example.com' });
    const cToken = await candidateToken(candidate.email);
    expect((await api(cToken).get(read.document.url)).status).toBe(403);
    expect((await api(cToken).get(signedCopy.url)).status).toBe(403);
    const publicView = expectStatus(await api(cToken).get(`/api/vacancies/${vacancy.id}`), 200).body;
    expect(Object.keys(publicView).filter((k) => k.startsWith('requisition'))).toEqual([]);
    expect(publicView.desirableQualifications).toHaveLength(1);

    // A readvertisement runs on the same requisition.
    expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/close`, { reason: 'No suitable candidates' }), 200);
    const re = expectStatus(await api(tokens.hro).post(`/api/vacancies/${vacancy.id}/readvertise`, {
      postingType: 'External', positionsRequired: 2, deadline: new Date(Date.now() + 20 * 86400000).toISOString()
    }), 201).body;
    expect(re.requisitionDocumentUrl).toBe(read.document.url);
    expect(re.requisitionSignedCopyUrl).toBe(signedCopy.url);
    expect(re.requisitionDocumentHash).toBeNull();
  });

  test('refuses scanned documents and formats it cannot read', async () => {
    const scanned = await upload(buildScannedPdf(), 'scan.pdf', 'application/pdf');
    expect(scanned.status).toBe(422);
    expect(scanned.body.code).toBe('SCANNED_DOCUMENT');

    const doc = await upload(Buffer.from('legacy'), 'old.doc', 'application/msword');
    expect(doc.status).toBe(422);
    const image = await upload(Buffer.from('jpeg'), 'photo.jpg', 'image/jpeg');
    expect(image.status).toBe(422);

    // The signed copy is the other way round: a scan or photo, never a Word file.
    const signedWord = await request(app).post('/api/vacancies/requisition/signed-copy').set('Authorization', `Bearer ${tokens.hro}`)
      .attach('document', await buildRequisitionDocx(), { filename: 'req.docx', contentType: DOCX });
    expect(signedWord.status).toBe(422);
    const signedPhoto = await request(app).post('/api/vacancies/requisition/signed-copy').set('Authorization', `Bearer ${tokens.hro}`)
      .attach('document', Buffer.from('\x89PNG fake image'), { filename: 'signed.png', contentType: 'image/png' });
    expect(signedPhoto.status).toBe(200);
    expect(signedPhoto.body.filename).toMatch(/\.png$/);
  });
});

test('a vacancy being written is saved as a private draft, and creating it removes the draft', async () => {
  const other = await createStaff('HR_Officer', 'hro2@caa.co.ug');
  const otherToken = await staffToken(other.email);
  const read = await uploadRequisition(tokens.hro);

  const signedCopy = await uploadSignedCopy(tokens.hro);
  const draft = expectStatus(await api(tokens.hro).post('/api/vacancy-drafts', { form: read.prefill, requisition: read, signedCopy }), 201).body;
  expect(draft.title).toBe('HR Analyst');

  // Saved again over the version this window loaded...
  const saved = expectStatus(await request(app).put(`/api/vacancy-drafts/${draft.id}`).set('Authorization', `Bearer ${tokens.hro}`)
    .send({ form: { ...read.prefill, salaryScale: 'U4' }, requisition: read, signedCopy, baseUpdatedAt: draft.updatedAt }), 200).body;
  // ...but a second window still holding the old version can't overwrite it.
  const stale = await request(app).put(`/api/vacancy-drafts/${draft.id}`).set('Authorization', `Bearer ${tokens.hro}`)
    .send({ form: read.prefill, requisition: read, baseUpdatedAt: draft.updatedAt });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('DRAFT_CHANGED');

  // Private to its writer.
  expect(expectStatus(await api(otherToken).get('/api/vacancy-drafts'), 200).body).toEqual([]);
  expect((await api(otherToken).get(`/api/vacancy-drafts/${draft.id}`)).status).toBe(404);
  const loaded = expectStatus(await api(tokens.hro).get(`/api/vacancy-drafts/${draft.id}`), 200).body;
  expect(loaded.form.salaryScale).toBe('U4');
  expect(loaded.signedCopy).toEqual(signedCopy);
  expect(new Date(loaded.updatedAt).toISOString()).toBe(new Date(saved.updatedAt).toISOString());

  // The cleanup job keeps the draft's requisition and its signed copy.
  const cleanup = require('../scripts/cleanupRequisitionUploads');
  await cleanup.run(new Date(Date.now() + cleanup.GRACE_MS + 60000));
  expectStatus(await api(tokens.hro).get(read.document.url), 200);
  expectStatus(await api(tokens.hro).get(signedCopy.url), 200);

  expectStatus(await api(tokens.hro).post('/api/vacancies', {
    ...loaded.form, deadline: new Date(Date.now() + 14 * 86400000).toISOString(),
    requisitionDocument: read.document, requisitionSignedCopy: loaded.signedCopy, requisitionConfirmed: true, draftId: draft.id
  }), 201);
  expect(expectStatus(await api(tokens.hro).get('/api/vacancy-drafts'), 200).body).toEqual([]);
});

test('the cleanup job removes requisition uploads nothing refers to', async () => {
  const unused = await uploadRequisition(tokens.hro);
  const cleanup = require('../scripts/cleanupRequisitionUploads');
  expect(await cleanup.run(new Date())).toMatch(/0 unused/); // still within its grace period
  expectStatus(await api(tokens.hro).get(unused.document.url), 200);
  await cleanup.run(new Date(Date.now() + cleanup.GRACE_MS + 60000));
  expect((await api(tokens.hro).get(unused.document.url)).status).toBe(404);
});
