const request = require('supertest');
const http = require('http');
const {
  prisma, app, resetDatabase, createStaff, createOrg, createCandidate, staffToken, api, expectStatus, createVacancyFromRequisition
} = require('./helpers');

// Mark as Hired opens exactly one onboarding case per accepted offer and
// hands it to the HRIS (FR-ATS-067 to 069, BR-ATS-11); vacancies are checked
// against the position's approved headcount (FR-ATS-006).

let staff;
let tokens;
let org;

beforeEach(async () => {
  await resetDatabase();
  delete process.env.HRIS_HANDOFF_URL;
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    phro: await createStaff('Principal_HR_Officer', 'phro@caa.co.ug'),
    manager: await createStaff('Manager', 'manager@caa.co.ug'),
    director: await createStaff('Director', 'dhra@caa.co.ug')
  };
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
  org = await createOrg(staff.hro.id);
});

afterAll(async () => {
  delete process.env.HRIS_HANDOFF_URL;
  await prisma.$disconnect();
});

async function acceptedOffer() {
  const vacancy = await prisma.vacancy.create({
    data: {
      jobRef: 'UCAA/ADV/EXT/900/2026', title: 'HR Analyst', positionId: org.position.id, departmentId: org.department.id,
      postingType: 'External', status: 'Filled', positionsRequired: 1, createdById: staff.hro.id, approvedById: staff.manager.id, approvedAt: new Date()
    }
  });
  const candidate = await createCandidate({ fullName: 'Grace Hired', email: 'grace@example.com' });
  const application = await prisma.application.create({ data: { candidateId: candidate.id, vacancyId: vacancy.id, status: 'Offered', submittedDate: new Date() } });
  const offer = await prisma.offer.create({
    data: {
      applicationId: application.id, status: 'Accepted', recommendedById: staff.phro.id, approvedById: staff.manager.id, approvedDate: new Date(),
      decidedAt: new Date(), salaryAmount: 4500000, salaryCurrency: 'UGX', salaryPeriod: 'Monthly', employmentCategory: 'FullTime',
      startDate: new Date(Date.now() + 30 * 86400000), responseDays: 14
    }
  });
  return { vacancy, candidate, application, offer };
}

const markHired = (offerId, token = tokens.phro) => request(app).post(`/api/applications/offers/${offerId}/hire`)
  .set('Authorization', `Bearer ${token}`)
  .attach('signedInstrument', Buffer.from('%PDF-1.4 signed appointment'), { filename: 'appointment-signed.pdf', contentType: 'application/pdf' });

test('marking hired twice at once opens exactly one onboarding case, and fills a post', async () => {
  await prisma.position.update({ where: { id: org.position.id }, data: { headcount: 3, occupied: 1 } });
  const { offer } = await acceptedOffer();

  // Needs the signed appointing instrument, and a Principal HR Officer.
  expect(expectStatus(await api(tokens.phro).post(`/api/applications/offers/${offer.id}/hire`), 400).body.code).toBe('SIGNED_INSTRUMENT_REQUIRED');
  expectStatus(await markHired(offer.id, tokens.hro), 403);

  const [a, b] = await Promise.all([markHired(offer.id), markHired(offer.id)]);
  expect([a.status, b.status].sort()).toEqual([200, 201]);
  const created = a.status === 201 ? a.body : b.body;
  expect(created.caseRef).toMatch(/^UCAA\/ONB\/001\/\d{4}$/);
  expect(created.handoffStatus).toBe('NotConfigured');
  expect((a.status === 200 ? a.body : b.body).alreadyHired).toBe(true);
  expect(await prisma.hire.count()).toBe(1);
  expect((await prisma.position.findUnique({ where: { id: org.position.id } })).occupied).toBe(2);

  // The package carries the person, the terms and the signed document.
  const pkg = expectStatus(await api(tokens.phro).get(`/api/applications/offers/${offer.id}/hire/package`), 200);
  const body = JSON.parse(pkg.text);
  expect(body.person.fullName).toBe('Grace Hired');
  expect(body.terms.salaryAmount).toBe(4500000);
  expect(body.documents[0]).toEqual(expect.objectContaining({ kind: 'SignedAppointingInstrument', sha256: expect.any(String) }));
  expect(expectStatus(await api(tokens.hro).get('/api/applications/hires'), 200).body).toHaveLength(1);
});

test('a declined offer cannot be marked hired', async () => {
  const { offer } = await acceptedOffer();
  await prisma.offer.update({ where: { id: offer.id }, data: { status: 'Declined' } });
  expectStatus(await markHired(offer.id), 422);
});

test('the case is sent to the HRIS with the case reference as the idempotency key; failures are kept for retry', async () => {
  const received = [];
  let fail = true;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      received.push({ key: req.headers['idempotency-key'], auth: req.headers.authorization, body: JSON.parse(data) });
      if (fail) { res.writeHead(503); res.end('busy'); return; }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ onboardingCaseId: 'HRIS-77' }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.HRIS_HANDOFF_URL = `http://127.0.0.1:${server.address().port}/onboarding`;
  process.env.HRIS_HANDOFF_TOKEN = 'secret';
  try {
    const { offer } = await acceptedOffer();
    const first = expectStatus(await markHired(offer.id), 201).body;
    expect(first.handoffStatus).toBe('Pending');
    expect(first.handoffAttempts).toBe(1);
    expect(received[0]).toEqual(expect.objectContaining({ key: first.caseRef, auth: 'Bearer secret' }));

    fail = false;
    const retried = expectStatus(await api(tokens.phro).post(`/api/applications/offers/${offer.id}/hire/retry`), 200).body;
    expect(retried).toEqual(expect.objectContaining({ handoffStatus: 'Sent', onboardingCaseId: 'HRIS-77' }));
    expect(received[1].key).toBe(first.caseRef);
    expectStatus(await api(tokens.phro).post(`/api/applications/offers/${offer.id}/hire/retry`), 409);
  } finally {
    delete process.env.HRIS_HANDOFF_TOKEN;
    server.close();
  }
});

test('a vacancy above the approved headcount needs a reason, and a Director to authorise it', async () => {
  expectStatus(await api(tokens.hro).put(`/api/positions/${org.position.id}/headcount`, { headcount: 2, occupied: 1 }), 403);
  const set = expectStatus(await api(tokens.phro).put(`/api/positions/${org.position.id}/headcount`, { headcount: 2, occupied: 1 }), 200).body;
  expect(set.available).toBe(1);

  const body = { positionId: org.position.id, postingType: 'External', positionsRequired: 2, deadline: new Date(Date.now() + 14 * 86400000).toISOString() };
  const refused = expectStatus(await createVacancyFromRequisition(tokens.hro, body), 422).body;
  expect(refused.code).toBe('HEADCOUNT_EXCEEDED');
  expect(refused.headcount).toEqual(expect.objectContaining({ headcount: 2, occupied: 1, available: 1 }));

  const vacancy = expectStatus(await createVacancyFromRequisition(tokens.hro, { ...body, headcountExceptionReason: 'Two retirements due in March' }, { title: 'Second requisition' }), 201).body;
  expect(vacancy.requisitionDetails.headcountException).toEqual(expect.objectContaining({ requested: 2, available: 1 }));

  // A Manager can't approve it; a Director must authorise the exception.
  expect(expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 403).body.code).toBe('HEADCOUNT_EXCEPTION_NEEDS_DIRECTOR');
  expect(expectStatus(await api(tokens.director).patch(`/api/vacancies/${vacancy.id}/approve`), 422).body.code).toBe('HEADCOUNT_EXCEPTION_NOT_AUTHORISED');
  const approved = expectStatus(await api(tokens.director).patch(`/api/vacancies/${vacancy.id}/approve`, { authoriseHeadcountException: true }), 200).body;
  expect(approved.requisitionDetails.headcountException.authorisedById).toBe(staff.director.id);

  // The posts it asks for now count against the headcount.
  expect(expectStatus(await api(tokens.hro).get(`/api/positions/${org.position.id}/headcount`), 200).body).toEqual(
    expect.objectContaining({ inRecruitment: 2, available: 0 })
  );
});
