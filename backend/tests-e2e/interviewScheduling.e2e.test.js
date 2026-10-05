const {
  prisma, resetDatabase, createStaff, createOrg, createCandidate,
  staffToken, candidateToken, api, REFEREES, expectStatus, attachAcademicDocument, createVacancyFromRequisition,
  recordInterviewResults, attachExcoApproval
} = require('./helpers');

// The Interview Hub against a real database: a bulk-scheduled session with
// a shared panel, calendar invitations, clash detection, the candidate asking
// to move, reschedule, cancel, the HR Officer recording the panel's results
// (scored on paper, outside the system) with the signed sheet, correcting
// them, and what the candidate can and can't see.

let staff;
let tokens;
let org;

beforeEach(async () => {
  await resetDatabase();
  staff = {
    hro: await createStaff('HR_Officer', 'hro@caa.co.ug'),
    shro: await createStaff('Senior_HR_Officer', 'shro@caa.co.ug'),
    phro: await createStaff('Principal_HR_Officer', 'phro@caa.co.ug'),
    manager: await createStaff('Manager', 'manager@caa.co.ug')
  };
  tokens = {};
  for (const [key, s] of Object.entries(staff)) tokens[key] = await staffToken(s.email);
  org = await createOrg(staff.hro.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const inDays = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
// A fixed weekday morning well in the future, so slot times are predictable.
const SESSION_START = '2031-03-04T06:00:00.000Z'; // Tuesday 09:00 Kampala

async function shortlistedVacancy(names, { exco = true } = {}) {
  const vacancy = expectStatus(await createVacancyFromRequisition(tokens.hro, {
    positionId: org.position.id, postingType: 'External', deadline: inDays(30), positionsRequired: 1
  }), 201).body;
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);

  const applicants = [];
  for (const [i, fullName] of names.entries()) {
    const candidate = await createCandidate({ fullName, email: `c${i}@example.com` });
    const token = await candidateToken(candidate.email);
    const draft = expectStatus(await api(token).post('/api/applications', { vacancyId: vacancy.id, referees: REFEREES }), 201).body;
    await attachAcademicDocument(token, draft.id);
    expectStatus(await api(token).patch(`/api/applications/${draft.id}/submit`, { consent: true }), 200);
    applicants.push({ token, applicationId: draft.id, candidateId: candidate.id });
  }
  const ids = applicants.map((a) => a.applicationId);
  expectStatus(await api(tokens.shro).patch(`/api/vacancies/${vacancy.id}/begin-review`), 200);
  const versions = Object.fromEntries((await prisma.application.findMany({ where: { id: { in: ids } } })).map((a) => [a.id, a.rankVersion]));
  expectStatus(await api(tokens.shro).post(`/api/vacancies/${vacancy.id}/rank`, { applicationIds: ids, applicationRankVersions: versions }), 200);
  expectStatus(await api(tokens.phro).post(`/api/applications/vacancies/${vacancy.id}/approve-shortlist`), 200);
  if (exco) expectStatus(await attachExcoApproval(tokens.shro, vacancy.id), 201);
  return { vacancy, applicants };
}

const sessionBody = (applicationIds) => ({
  applicationIds,
  startsAt: SESSION_START,
  durationMinutes: 30,
  gapMinutes: 10,
  mode: 'In-person',
  location: 'Board Room B',
  instructions: 'Bring your national ID.',
  panelMembers: [
    { name: 'Ann Chair', email: 'ann@caa.co.ug', isChair: true },
    { name: 'External Assessor' }
  ]
});

test('a bulk session is planned, booked, rescheduled, cancelled, and its results recorded', async () => {
  const { vacancy, applicants } = await shortlistedVacancy(['Amy Apio', 'Ben Byaru', 'Cate Chebet']);
  const [amy, ben, cate] = applicants;
  const ids = applicants.map((a) => a.applicationId);

  // The scheduler's context lists everyone who can be scheduled.
  const context = expectStatus(await api(tokens.hro).get(`/api/interviews/vacancies/${vacancy.id}/scheduling-context`), 200).body;
  expect(context.applications.map((a) => a.id).sort()).toEqual([...ids].sort());

  // Dry run: back-to-back slots, nothing booked.
  const plan = expectStatus(await api(tokens.shro).post(`/api/interviews/vacancies/${vacancy.id}/plan`, sessionBody(ids)), 200).body;
  expect(plan.slots.map((s) => s.start)).toEqual(['2031-03-04T06:00:00.000Z', '2031-03-04T06:40:00.000Z', '2031-03-04T07:20:00.000Z']);
  expect(plan.conflicts).toEqual([]);
  expect(await prisma.interviewRound.count()).toBe(0);

  // Book it - HR Officers can read the Hub but not schedule.
  expect((await api(tokens.hro).post(`/api/interviews/vacancies/${vacancy.id}/sessions`, sessionBody(ids))).status).toBe(403);
  const session = expectStatus(await api(tokens.shro).post(`/api/interviews/vacancies/${vacancy.id}/sessions`, sessionBody(ids)), 201).body;
  expect(session.rounds).toHaveLength(3);
  expect(new Set(session.rounds.map((r) => r.sessionKey)).size).toBe(1);
  const apps = await prisma.application.findMany({ where: { id: { in: ids } } });
  expect(apps.every((a) => a.status === 'InterviewScheduled')).toBe(true);
  expect(await prisma.candidateNotification.count({ where: { type: 'InterviewScheduled', channel: 'InApp' } })).toBe(3);

  const roundOf = (applicationId) => session.rounds.find((r) => r.applicationId === applicationId);

  // A second round for Amy overlapping her own slot and Ben's, with the same
  // chair, clashes on both counts - reported, not booked.
  const clash = await api(tokens.shro).post(`/api/interviews/applications/${amy.applicationId}/interviews`, {
    scheduledDate: '2031-03-04T06:15:00.000Z', durationMinutes: 30, mode: 'Virtual', meetingLink: 'https://meet.example/x',
    panelMembers: [{ name: 'Ann C.', email: 'ANN@caa.co.ug' }]
  });
  expect(clash.status).toBe(409);
  expect(clash.body.code).toBe('SCHEDULE_CONFLICT');
  expect([...new Set(clash.body.conflicts.map((c) => c.type))].sort()).toEqual(['candidate', 'panelist']);

  // Amy asks to move; whoever scheduled it is told.
  expectStatus(await api(amy.token).patch(`/api/candidates/me/interviews/${roundOf(amy.applicationId).id}/respond`, {
    response: 'RescheduleRequested', note: 'I sit an exam that morning - any afternoon that week works.'
  }), 200);
  expect(await prisma.notification.count({ where: { recipientId: staff.shro.id, taskType: 'InterviewRescheduleRequested', channel: 'InApp' } })).toBe(1);
  const attention = expectStatus(await api(tokens.hro).get('/api/interviews/attention'), 200).body;
  expect(attention.rescheduleRequests.map((r) => r.id)).toEqual([roundOf(amy.applicationId).id]);

  // HR moves her to the afternoon; her answer resets to Pending.
  const moved = expectStatus(await api(tokens.shro).patch(`/api/interviews/${roundOf(amy.applicationId).id}/reschedule`, {
    scheduledDate: '2031-03-04T11:00:00.000Z', reason: 'Candidate exam clash'
  }), 200).body;
  expect(moved.rescheduleCount).toBe(1);
  expect(moved.candidateResponse).toBe('Pending');
  expectStatus(await api(amy.token).patch(`/api/candidates/me/interviews/${moved.id}/respond`, { response: 'Confirmed' }), 200);

  // Cate's interview is cancelled - she goes back to Shortlisted.
  const cateRound = roundOf(cate.applicationId);
  expectStatus(await api(tokens.shro).patch(`/api/interviews/${cateRound.id}/cancel`, { reason: 'Candidate withdrew verbally' }), 200);
  expect((await prisma.application.findUnique({ where: { id: cate.applicationId } })).status).toBe('Shortlisted');

  // Ben's panel scores him on paper. Results can't be entered before the
  // interview time, nor without the signed sheet.
  const benRound = roundOf(ben.applicationId);
  expect((await recordInterviewResults(tokens.hro, benRound.id, { backdate: false })).status).toBe(422);
  expect((await recordInterviewResults(tokens.hro, benRound.id, { sheet: false })).status).toBe(400);
  expect((await recordInterviewResults(tokens.hro, benRound.id, { score: 120 })).status).toBe(400);

  // The HR Officer records them: the round is held, Ben is Interviewed.
  const recorded = expectStatus(await recordInterviewResults(tokens.hro, benRound.id, {
    score: 78.25, recommendation: 'Hold', notes: 'Strong technically; panel split on leadership'
  }), 200).body;
  expect(recorded).toEqual(expect.objectContaining({ status: 'Completed', score: 78.3, recommendation: 'Hold', resultNotes: 'Strong technically; panel split on leadership' }));
  expect(recorded.scoreSheetUrl).toMatch(/^\/api\/files\//);
  expect(recorded.conductedById).toBe(staff.hro.id);
  expect((await prisma.application.findUnique({ where: { id: ben.applicationId } })).status).toBe('Interviewed');
  // Recording again is a correction - no new sheet needed - and is audited.
  const corrected = expectStatus(await api(tokens.hro).patch(`/api/interviews/${benRound.id}/results`, { score: 81, recommendation: 'Shortlist' }), 200).body;
  expect(corrected).toEqual(expect.objectContaining({ score: 81, recommendation: 'Shortlist', scoreSheetUrl: recorded.scoreSheetUrl }));
  expect(await prisma.auditLog.count({ where: { entityType: 'InterviewRound', entityId: benRound.id, action: 'Interview results corrected' } })).toBe(1);
  // Staff can open the signed sheet.
  expect((await api(tokens.hro).get(recorded.scoreSheetUrl)).status).toBe(200);
  expect((await api(ben.token).get(recorded.scoreSheetUrl)).status).toBe(403);

  // The scorecard ranks the interviewed candidates, with the sheet.
  const scorecard = expectStatus(await api(tokens.hro).get(`/api/interviews/vacancies/${vacancy.id}/scorecard`), 200).body;
  expect(scorecard[0]).toEqual(expect.objectContaining({ applicationId: ben.applicationId }));
  expect(scorecard[0].latestRound).toEqual(expect.objectContaining({ score: 81, recommendation: 'Shortlist', scoreSheetUrl: recorded.scoreSheetUrl }));

  // The candidate sees the time, venue and instructions - never the panel's
  // scores or verdict - and can download a calendar file.
  const mine = expectStatus(await api(ben.token).get('/api/candidates/me/applications'), 200).body;
  const benSeen = mine.find((a) => a.id === ben.applicationId).interviewRounds[0];
  expect(benSeen).toEqual(expect.objectContaining({ status: 'Held', location: 'Board Room B', instructions: 'Bring your national ID.' }));
  expect(benSeen.score).toBeUndefined();
  expect(benSeen.recommendation).toBeUndefined();
  const ics = await api(amy.token).get(`/api/candidates/me/interviews/${moved.id}/calendar.ics`);
  expect(ics.status).toBe(200);
  expect(ics.text).toContain('DTSTART:20310304T110000Z');
  // Not someone else's.
  expect((await api(amy.token).get(`/api/candidates/me/interviews/${benRound.id}/calendar.ics`)).status).toBe(404);

  // The agenda lists the remaining booked interviews for the vacancy.
  const agenda = expectStatus(await api(tokens.hro).get(`/api/interviews?vacancyId=${vacancy.id}&status=Scheduled`), 200).body;
  expect(agenda.map((r) => r.id)).toEqual([moved.id]);
});

test('a "Reject" verdict rejects the application, and is final; a no-show has no results', async () => {
  const { vacancy, applicants } = await shortlistedVacancy(['Dan Dumba', 'Eve Ekwang']);
  const [dan, eve] = applicants;
  const book = async (applicationId) => expectStatus(await api(tokens.shro).post(`/api/interviews/applications/${applicationId}/interviews`, {
    scheduledDate: inDays(4), mode: 'In person',
    panelMembers: [{ name: 'P One', email: 'p1@caa.co.ug' }, { name: 'P Two', email: 'p2@caa.co.ug' }]
  }), 201).body;
  const danRound = await book(dan.applicationId);
  expect(danRound.mode).toBe('In-person');

  expectStatus(await recordInterviewResults(tokens.hro, danRound.id, { score: 38, recommendation: 'Reject' }), 200);
  const rejected = await prisma.application.findUnique({ where: { id: dan.applicationId } });
  expect(rejected).toEqual(expect.objectContaining({ status: 'Rejected', rejectedById: staff.hro.id }));
  expect(await prisma.candidateNotification.count({ where: { candidateId: dan.candidateId, type: 'ApplicationRejected', channel: 'InApp' } })).toBe(1);
  expect((await api(tokens.hro).patch(`/api/interviews/${danRound.id}/results`, { score: 60, recommendation: 'Hold' })).status).toBe(409);

  const eveRound = await book(eve.applicationId);
  await prisma.interviewRound.update({ where: { id: eveRound.id }, data: { scheduledDate: new Date(Date.now() - 3600000) } });
  expectStatus(await api(tokens.shro).patch(`/api/interviews/${eveRound.id}/no-show`, {}), 200);
  expect((await recordInterviewResults(tokens.hro, eveRound.id, { backdate: false })).status).toBe(409);

  // A vacancy with nothing interviewed still has a (short) scorecard.
  expectStatus(await api(tokens.hro).get(`/api/interviews/vacancies/${vacancy.id}/scorecard`), 200);
});

test('EXCO approves the shortlist outside the system: nobody is told or interviewed before the signed copy is attached', async () => {
  const { vacancy, applicants } = await shortlistedVacancy(['Fay Fiona', 'Gil Gaba', 'Hal Hamza'], { exco: false });
  const [fay, gil, hal] = applicants;
  expect(await prisma.candidateNotification.count({ where: { type: 'ApplicationShortlisted' } })).toBe(0);

  const booking = { scheduledDate: inDays(5), mode: 'In person', panelMembers: [{ name: 'P One', email: 'p1@caa.co.ug' }] };
  const early = await api(tokens.shro).post(`/api/interviews/applications/${fay.applicationId}/interviews`, booking);
  expect(early.status).toBe(409);
  expect(early.body.code).toBe('EXCO_APPROVAL_REQUIRED');

  // The sheet to print lists everyone waiting.
  const sheet = expectStatus(await api(tokens.hro).get(`/api/vacancies/${vacancy.id}/exco-shortlist`), 200).body;
  expect(sheet.awaiting.map((a) => a.candidateName).sort()).toEqual(['Fay Fiona', 'Gil Gaba', 'Hal Hamza']);

  // HR Officers can print it; attaching is for whoever schedules.
  expect((await attachExcoApproval(tokens.hro, vacancy.id)).status).toBe(403);
  expect((await attachExcoApproval(tokens.shro, vacancy.id, { struckOff: [fay.applicationId, gil.applicationId, hal.applicationId] })).status).toBe(422);
  const attached = expectStatus(await attachExcoApproval(tokens.shro, vacancy.id, { struckOff: [hal.applicationId], excoReference: 'EXCO MIN 31/2026' }), 201).body;
  expect(attached).toEqual(expect.objectContaining({ approved: 2, struckOff: 1 }));

  // Hal was struck off: rejected and told. Fay and Gil are told they're shortlisted.
  const halApp = await prisma.application.findUnique({ where: { id: hal.applicationId } });
  expect(halApp).toEqual(expect.objectContaining({ status: 'Rejected', rejectionReason: 'Not approved for interview by EXCO.', excoApprovalId: null }));
  const notices = await prisma.candidateNotification.findMany({ where: { channel: 'InApp' }, select: { candidateId: true, type: true } });
  expect(notices).toEqual(expect.arrayContaining([
    { candidateId: fay.candidateId, type: 'ApplicationShortlisted' },
    { candidateId: gil.candidateId, type: 'ApplicationShortlisted' },
    { candidateId: hal.candidateId, type: 'ApplicationRejected' }
  ]));

  expectStatus(await api(tokens.shro).post(`/api/interviews/applications/${fay.applicationId}/interviews`, booking), 201);
  const after = expectStatus(await api(tokens.hro).get(`/api/vacancies/${vacancy.id}/exco-shortlist`), 200).body;
  expect(after.awaiting).toEqual([]);
  expect(after.approvals[0]).toEqual(expect.objectContaining({
    excoReference: 'EXCO MIN 31/2026', struckOff: [{ applicationId: hal.applicationId, candidateName: 'Hal Hamza' }]
  }));
  expect(after.approvals[0].approved.map((a) => a.candidateName).sort()).toEqual(['Fay Fiona', 'Gil Gaba']);
  expectStatus(await api(tokens.hro).get(after.approvals[0].documentUrl), 200);
  expect((await attachExcoApproval(tokens.shro, vacancy.id)).status).toBe(422); // nobody left waiting
  expect(await prisma.auditLog.count({ where: { entityType: 'Vacancy', entityId: vacancy.id, action: 'EXCO shortlist approval attached' } })).toBe(1);
});
