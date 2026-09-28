const {
  prisma, resetDatabase, createStaff, createOrg, createCandidate,
  staffToken, candidateToken, api, REFEREES, expectStatus
} = require('./helpers');

// The Interview Hub against a real database: a bulk-scheduled session with
// a shared panel and rubric, clash detection, the candidate asking to move,
// reschedule, cancel, panelist self-scoring through a link, finalizing, and
// what the candidate can and can't see.

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

async function shortlistedVacancy(names) {
  const vacancy = expectStatus(await api(tokens.hro).post('/api/vacancies', {
    positionId: org.position.id, postingType: 'External', deadline: inDays(30), positionsRequired: 1
  }), 201).body;
  expectStatus(await api(tokens.manager).patch(`/api/vacancies/${vacancy.id}/approve`), 200);

  const applicants = [];
  for (const [i, fullName] of names.entries()) {
    const candidate = await createCandidate({ fullName, email: `c${i}@example.com` });
    const token = await candidateToken(candidate.email);
    const draft = expectStatus(await api(token).post('/api/applications', { vacancyId: vacancy.id, referees: REFEREES }), 201).body;
    expectStatus(await api(token).patch(`/api/applications/${draft.id}/submit`), 200);
    applicants.push({ token, applicationId: draft.id, candidateId: candidate.id });
  }
  const ids = applicants.map((a) => a.applicationId);
  expectStatus(await api(tokens.shro).patch(`/api/vacancies/${vacancy.id}/begin-review`), 200);
  const versions = Object.fromEntries((await prisma.application.findMany({ where: { id: { in: ids } } })).map((a) => [a.id, a.rankVersion]));
  expectStatus(await api(tokens.shro).post(`/api/vacancies/${vacancy.id}/rank`, { applicationIds: ids, applicationRankVersions: versions }), 200);
  expectStatus(await api(tokens.phro).post(`/api/applications/vacancies/${vacancy.id}/approve-shortlist`), 200);
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
  ],
  criteria: [{ name: 'Technical knowledge', weight: 3 }, { name: 'Communication', weight: 1 }]
});

test('a bulk session is planned, booked, rescheduled, cancelled, scored and finalized', async () => {
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
  expect(session.rounds[0].criteria.map((c) => c.name)).toEqual(['Technical knowledge', 'Communication']);
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

  // Cate's interview is cancelled: she goes back to Shortlisted and any
  // scoring link already sent for it stops working.
  const cateRound = roundOf(cate.applicationId);
  const links = expectStatus(await api(tokens.shro).post(`/api/interviews/${cateRound.id}/access-links`), 201).body.results;
  const externalLink = links.find((l) => l.name === 'External Assessor').url;
  expectStatus(await api(tokens.shro).patch(`/api/interviews/${cateRound.id}/cancel`, { reason: 'Candidate withdrew verbally' }), 200);
  expect((await prisma.application.findUnique({ where: { id: cate.applicationId } })).status).toBe('Shortlisted');
  const token = externalLink.split('/panel-score/')[1];
  expect((await api().get(`/api/panel-access/${token}`)).status).toBe(410);

  // Ben's panel scores: the chair's proxied by HR against the rubric, the
  // external assessor's through their own link.
  const benRound = expectStatus(await api(tokens.hro).get(`/api/interviews/${roundOf(ben.applicationId).id}`), 200).body;
  const [tech, comms] = benRound.criteria;
  const chair = benRound.panelMembers.find((m) => m.isChair);
  const assessor = benRound.panelMembers.find((m) => !m.isChair);
  expectStatus(await api(tokens.shro).patch(`/api/interviews/panel-members/${chair.id}/score`, {
    criterionScores: { [tech.id]: 5, [comms.id]: 3 }, comments: 'Excellent technical depth'
  }), 200);

  const link = expectStatus(await api(tokens.shro).post(`/api/interviews/panel-members/${assessor.id}/access-link`), 201).body.url;
  const panelToken = link.split('/panel-score/')[1];
  const view = expectStatus(await api().get(`/api/panel-access/${panelToken}`), 200).body;
  expect(view.criteria.map((c) => c.name)).toEqual(['Technical knowledge', 'Communication']);
  expect((await api().patch(`/api/panel-access/${panelToken}/score`, { criterionScores: { [tech.id]: 9 } })).status).toBe(400);
  expectStatus(await api().patch(`/api/panel-access/${panelToken}/score`, { criterionScores: { [tech.id]: 4, [comms.id]: 4 } }), 200);

  // (3*1 + 1*0.6)/4 = 90 and (3*0.8 + 1*0.8)/4 = 80 -> average 85.
  const scored = await prisma.interviewRound.findUnique({ where: { id: benRound.id } });
  expect(scored.score).toBe(85);
  expect(await prisma.notification.count({ where: { recipientId: staff.shro.id, taskType: 'InterviewReadyToFinalize', channel: 'InApp' } })).toBe(1);

  expectStatus(await api(tokens.shro).patch(`/api/interviews/${benRound.id}/finalize`, { recommendation: 'Shortlist' }), 200);
  const finalized = await prisma.interviewRound.findUnique({ where: { id: benRound.id } });
  expect(finalized.status).toBe('Completed');
  expect((await prisma.application.findUnique({ where: { id: ben.applicationId } })).status).toBe('Interviewed');

  // The scorecard ranks the interviewed candidates, with the rubric breakdown.
  const scorecard = expectStatus(await api(tokens.hro).get(`/api/interviews/vacancies/${vacancy.id}/scorecard`), 200).body;
  expect(scorecard[0]).toEqual(expect.objectContaining({ applicationId: ben.applicationId }));
  expect(scorecard[0].latestRound.criterionAverages.map((c) => c.average)).toEqual([4.5, 3.5]);

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

test('a recused panelist no longer counts, and a scored panelist cannot be removed', async () => {
  const { vacancy, applicants } = await shortlistedVacancy(['Dan Dumba']);
  const [dan] = applicants;
  const round = expectStatus(await api(tokens.shro).post(`/api/interviews/applications/${dan.applicationId}/interviews`, {
    scheduledDate: inDays(4), mode: 'In person',
    panelMembers: [{ name: 'P One', email: 'p1@caa.co.ug' }, { name: 'P Two', email: 'p2@caa.co.ug' }]
  }), 201).body;
  expect(round.mode).toBe('In-person');
  const [p1, p2] = round.panelMembers;

  expectStatus(await api(tokens.shro).patch(`/api/interviews/panel-members/${p1.id}/score`, { score: 40 }), 200);
  expectStatus(await api(tokens.shro).patch(`/api/interviews/panel-members/${p2.id}/score`, { score: 90 }), 200);
  expect((await api(tokens.shro).delete(`/api/interviews/panel-members/${p1.id}`)).status).toBe(409);

  expectStatus(await api(tokens.shro).patch(`/api/interviews/panel-members/${p1.id}/recuse`, { reason: 'Former supervisor of the candidate' }), 200);
  expect((await prisma.interviewRound.findUnique({ where: { id: round.id } })).score).toBe(90);
  expect(await prisma.auditLog.count({ where: { entityType: 'InterviewRound', entityId: round.id, action: 'Panelist recused' } })).toBe(1);

  // A vacancy with nothing interviewed yet still has a (short) scorecard.
  expectStatus(await api(tokens.hro).get(`/api/interviews/vacancies/${vacancy.id}/scorecard`), 200);
});
