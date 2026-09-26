jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const scheduling = require('../src/services/interviewSchedulingService');
const interviewService = require('../src/services/interviewService');
const { buildCalendar } = require('../src/utils/icsCalendar');
const { toCandidateInterview } = require('../src/utils/candidateInterview');

beforeEach(() => jest.clearAllMocks());

const iso = (slots) => slots.map((s) => s.start.toISOString());

describe('planSlots', () => {
  test('lays slots back to back with the changeover gap', () => {
    const slots = scheduling.planSlots({ startsAt: '2030-10-01T06:00:00Z', durationMinutes: 45, gapMinutes: 15, count: 3 });
    expect(iso(slots)).toEqual(['2030-10-01T06:00:00.000Z', '2030-10-01T07:00:00.000Z', '2030-10-01T08:00:00.000Z']);
    expect(slots[2].end.toISOString()).toBe('2030-10-01T08:45:00.000Z');
  });

  test('with maxPerDay, carries on the next day at the same start time, skipping the weekend', () => {
    // Friday 2030-10-04, 09:00 Kampala (06:00 UTC, offset -180).
    const slots = scheduling.planSlots({
      startsAt: '2030-10-04T06:00:00Z', durationMinutes: 60, maxPerDay: 2, tzOffsetMinutes: -180, count: 5
    });
    expect(iso(slots)).toEqual([
      '2030-10-04T06:00:00.000Z', '2030-10-04T07:00:00.000Z', // Friday
      '2030-10-07T06:00:00.000Z', '2030-10-07T07:00:00.000Z', // Monday
      '2030-10-08T06:00:00.000Z' // Tuesday
    ]);
  });

  test('keeps weekend days when skipWeekends is false', () => {
    const slots = scheduling.planSlots({
      startsAt: '2030-10-04T06:00:00Z', durationMinutes: 60, maxPerDay: 1, skipWeekends: false, tzOffsetMinutes: -180, count: 2
    });
    expect(iso(slots)[1]).toBe('2030-10-05T06:00:00.000Z');
  });

  test.each([
    [{ startsAt: 'not a date' }],
    [{ startsAt: '2030-10-01T06:00:00Z', durationMinutes: 2 }],
    [{ startsAt: '2030-10-01T06:00:00Z', gapMinutes: -5 }],
    [{ startsAt: '2030-10-01T06:00:00Z', maxPerDay: 0 }]
  ])('rejects bad input %p', (input) => {
    expect(() => scheduling.planSlots({ count: 1, ...input })).toThrow();
  });
});

describe('findConflicts', () => {
  const existing = (overrides) => ({
    id: 50, scheduledDate: new Date('2030-10-01T07:00:00Z'), durationMinutes: 60, mode: 'In-person', location: 'Board Room B',
    application: { candidateId: 7, candidate: { fullName: 'Other' }, vacancy: { jobRef: 'R1', title: 'T' } },
    panelMembers: [{ name: 'Ann Okello', email: null, staffUserId: null }],
    ...overrides
  });
  const slot = (start, minutes = 60, candidateId = 1) => ({
    key: 1, candidateId, start: new Date(start), end: new Date(new Date(start).getTime() + minutes * 60000)
  });

  test('touching end-to-start is not a clash', async () => {
    prisma.interviewRound.findMany.mockResolvedValue([existing()]);
    const conflicts = await scheduling.findConflicts({
      slots: [slot('2030-10-01T08:00:00Z')], panel: [{ name: 'Ann Okello' }], location: 'Board Room B', mode: 'In-person'
    });
    expect(conflicts).toEqual([]);
  });

  test('finds candidate, panelist (by name when no email) and room clashes on overlap', async () => {
    prisma.interviewRound.findMany.mockResolvedValue([existing()]);
    const conflicts = await scheduling.findConflicts({
      slots: [slot('2030-10-01T07:30:00Z', 60, 7)], panel: [{ name: ' ann  okello ' }], location: 'board room b', mode: 'In-person'
    });
    expect(conflicts.map((c) => c.type).sort()).toEqual(['candidate', 'panelist', 'room']);
  });

  test('a virtual interview never clashes on room', async () => {
    prisma.interviewRound.findMany.mockResolvedValue([existing()]);
    const conflicts = await scheduling.findConflicts({
      slots: [slot('2030-10-01T07:30:00Z')], panel: [], location: 'Board Room B', mode: 'Virtual'
    });
    expect(conflicts).toEqual([]);
  });

  test('panelists with different emails are different people, even with the same name', async () => {
    prisma.interviewRound.findMany.mockResolvedValue([existing({ panelMembers: [{ name: 'Ann', email: 'ann1@x.test' }] })]);
    const conflicts = await scheduling.findConflicts({
      slots: [slot('2030-10-01T07:30:00Z')], panel: [{ name: 'Ann', email: 'ann2@x.test' }]
    });
    expect(conflicts).toEqual([]);
  });

  test('an untimed slot is never checked', async () => {
    const conflicts = await scheduling.findConflicts({ slots: [{ key: 1, start: null, end: null }], panel: [] });
    expect(conflicts).toEqual([]);
    expect(prisma.interviewRound.findMany).not.toHaveBeenCalled();
  });
});

describe('rubric scoring', () => {
  test('normalizeCriteria keeps well-formed ids, generates the rest, and defaults weight to 1', () => {
    const criteria = interviewService.normalizeCriteria([
      { id: 'c_abcd1234', name: ' Technical ', weight: 3 },
      { name: 'Communication' },
      { name: '   ' }
    ]);
    expect(criteria).toEqual([
      { id: 'c_abcd1234', name: 'Technical', weight: 3, description: null },
      { id: expect.stringMatching(/^c_[0-9a-f]{8}$/), name: 'Communication', weight: 1, description: null }
    ]);
  });

  test('normalizeCriteria treats an empty rubric as none, and rejects duplicates and bad weights', () => {
    expect(interviewService.normalizeCriteria([])).toBeNull();
    expect(interviewService.normalizeCriteria(null)).toBeNull();
    expect(() => interviewService.normalizeCriteria([{ name: 'A' }, { name: 'a' }])).toThrow(/twice/);
    expect(() => interviewService.normalizeCriteria([{ name: 'A', weight: 0 }])).toThrow(/Weight/);
    expect(() => interviewService.normalizeCriteria([{ name: 'A', weight: 1.5 }])).toThrow(/Weight/);
  });

  test('scoreFromCriteria weights each 1-5 rating into a 0-100 score', () => {
    const criteria = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }];
    expect(interviewService.scoreFromCriteria(criteria, { a: 5, b: 5 }).score).toBe(100);
    expect(interviewService.scoreFromCriteria(criteria, { a: 3, b: 3 }).score).toBe(60);
    expect(interviewService.scoreFromCriteria(criteria, { a: 4, b: 3 }).score).toBe(70);
    expect(() => interviewService.scoreFromCriteria(criteria, { a: 6, b: 3 })).toThrow(/Rate "A"/);
    expect(() => interviewService.scoreFromCriteria(criteria, { a: 2.5, b: 3 })).toThrow();
  });

  test('panelProgress ignores recused panelists and reports the spread', () => {
    expect(interviewService.panelProgress([
      { score: 90 }, { score: 60 }, { score: null, recusedAt: new Date() }
    ])).toEqual({ total: 2, scored: 2, complete: true, spread: 30 });
    expect(interviewService.panelProgress([])).toEqual({ total: 0, scored: 0, complete: false, spread: null });
  });

  test('criterionAverages averages each criterion across active panelists', () => {
    const round = { criteria: [{ id: 'a', name: 'A', weight: 2 }] };
    const avgs = interviewService.criterionAverages(round, [
      { criterionScores: { a: 4 } }, { criterionScores: { a: 5 } }, { criterionScores: { a: 1 }, recusedAt: new Date() }
    ]);
    expect(avgs).toEqual([{ id: 'a', name: 'A', weight: 2, average: 4.5 }]);
  });
});

describe('statusAfterRoundClosed', () => {
  test.each([
    [[{ id: 1, status: 'Scheduled' }], 'Shortlisted'],
    [[{ id: 1, status: 'Scheduled' }, { id: 2, status: 'Scheduled' }], 'InterviewScheduled'],
    [[{ id: 1, status: 'Scheduled' }, { id: 2, status: 'Completed', recommendation: 'Hold' }], 'Interviewed'],
    [[{ id: 1, status: 'Scheduled' }, { id: 2, status: 'Cancelled' }], 'Shortlisted']
  ])('rounds %j -> %s', async (rounds, expected) => {
    prisma.interviewRound.findMany.mockResolvedValue(rounds);
    expect(await scheduling.statusAfterRoundClosed(10, 1)).toBe(expected);
  });
});

describe('buildCalendar', () => {
  test('produces a valid VEVENT with escaped text, UTC times and CRLF line endings', () => {
    const ics = buildCalendar({
      method: 'REQUEST',
      events: [{
        uid: 'interview-1@ucaa-erecruitment', start: new Date('2030-10-01T07:00:00Z'), end: new Date('2030-10-01T08:00:00Z'),
        sequence: 2, summary: 'Interview; round 1, ATC', description: 'Line one\nLine two', location: 'Room B'
      }]
    });
    expect(ics).toContain('METHOD:REQUEST\r\n');
    expect(ics).toContain('DTSTART:20301001T070000Z');
    expect(ics).toContain('SEQUENCE:2');
    expect(ics).toContain('SUMMARY:Interview\\; round 1\\, ATC');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true);
  });

  test('folds long lines', () => {
    const ics = buildCalendar({
      events: [{ uid: 'u', start: new Date(), end: new Date(), summary: 'x'.repeat(200) }]
    });
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true);
    expect(ics).toMatch(/\r\n x/);
  });
});

describe('toCandidateInterview', () => {
  test('never exposes scores, recommendation, internal notes or the rubric', () => {
    const out = toCandidateInterview({
      id: 1, applicationId: 2, roundNumber: 1, status: 'Completed', scheduledDate: new Date(), durationMinutes: 30,
      mode: 'Virtual', meetingLink: 'https://meet.example/x', instructions: 'Bring ID',
      score: 88, recommendation: 'Shortlist', internalNotes: 'Strong', criteria: [{ id: 'a' }], conductedById: 3,
      candidateResponse: 'Confirmed', rescheduleCount: 0
    });
    expect(out.status).toBe('Held');
    for (const hidden of ['score', 'recommendation', 'internalNotes', 'criteria', 'conductedById']) {
      expect(out).not.toHaveProperty(hidden);
    }
    expect(out.meetingLink).toBe('https://meet.example/x');
  });

  test('a cancelled round drops its venue and joining link but keeps the reason', () => {
    const out = toCandidateInterview({
      id: 1, status: 'Cancelled', meetingLink: 'https://meet.example/x', location: 'Room', cancellationReason: 'Panel unavailable'
    });
    expect(out.meetingLink).toBeNull();
    expect(out.location).toBeNull();
    expect(out.cancellationReason).toBe('Panel unavailable');
  });
});
