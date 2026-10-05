jest.mock('../src/config/db', () => require('./__mocks__/db'));
jest.mock('../src/utils/mailer', () => ({ sendMail: jest.fn() }));

const prisma = require('../src/config/db');
const { sendMail } = require('../src/utils/mailer');
const interviewController = require('../src/controllers/interviewController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn();
  return res;
}

// A round as interviewModel.findDetailed/findManyDetailed returns it.
function detailedRound(overrides = {}) {
  return {
    id: 1, applicationId: 1, roundNumber: 1, status: 'Scheduled',
    scheduledDate: new Date('2030-10-01T07:00:00Z'), durationMinutes: 60,
    mode: 'In-person', location: 'Board Room', meetingLink: null, instructions: null, internalNotes: null,
    rescheduleCount: 0, candidateResponse: 'Pending', scheduledById: 9,
    recommendation: null, score: null,
    application: {
      id: 1, status: 'InterviewScheduled', candidateId: 5,
      candidate: { id: 5, fullName: 'Jane Doe', email: 'jane@example.test' },
      vacancy: { id: 3, jobRef: 'UCAA/ADV/EXT/01/2030', title: 'Air Traffic Controller', createdById: 2 },
      offer: null
    },
    panelMembers: [],
    ...overrides
  };
}

// A still-Scheduled round elsewhere, as the clash query selects it.
function clashRound(overrides = {}) {
  return {
    id: 50, scheduledDate: new Date('2030-10-01T07:30:00Z'), durationMinutes: 60, mode: 'In-person', location: 'Board Room',
    application: { candidateId: 77, candidate: { fullName: 'Other Person' }, vacancy: { jobRef: 'UCAA/2', title: 'Engineer' } },
    panelMembers: [],
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.candidate.findUnique.mockResolvedValue({ id: 5, email: 'jane@example.test' });
  prisma.$transaction.mockImplementation((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
});

describe('schedule', () => {
  const schedulable = { id: 1, status: 'Shortlisted', offer: null, candidateId: 5, vacancy: { title: 'Air Traffic Controller' } };

  test('rejects an invalid application id', async () => {
    const res = mockRes();
    await interviewController.schedule({ params: { applicationId: 'abc' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('returns 404 when the application does not exist', async () => {
    prisma.application.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await interviewController.schedule({ params: { applicationId: '1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test.each(['Draft', 'Submitted', 'UnderReview', 'Offered', 'Rejected', 'Withdrawn'])(
    'refuses to schedule an interview for an application at status %s', async (status) => {
      prisma.application.findUnique.mockResolvedValue({ id: 1, status, offer: null });
      const res = mockRes();
      await interviewController.schedule({ params: { applicationId: '1' }, body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(prisma.interviewRound.create).not.toHaveBeenCalled();
    }
  );

  test('refuses another round for a candidate already ranked on the merit list', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'Interviewed', offer: null, meritStatus: 'Proposed' });
    const res = mockRes();
    await interviewController.schedule({ params: { applicationId: '1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/merit list/) });
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('refuses to schedule an interview for an application that already has an offer', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'Interviewed', offer: { id: 9 } });
    const res = mockRes();
    await interviewController.schedule({ params: { applicationId: '1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('books the round with its time and venue, moves the application to InterviewScheduled and notifies the candidate', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    prisma.interviewRound.findMany
      .mockResolvedValueOnce([]) // clash check
      .mockResolvedValueOnce([detailedRound()]);
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.count.mockResolvedValue(0);
    prisma.interviewRound.create.mockResolvedValue({ id: 1, applicationId: 1 });

    const res = mockRes();
    await interviewController.schedule({
      params: { applicationId: '1' },
      body: { scheduledDate: '2030-10-01T07:00:00Z', durationMinutes: 45, mode: 'In-person', location: 'Board Room', panelMembers: [] },
      user: { id: 9 }
    }, res);

    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: { in: ['Shortlisted', 'InterviewScheduled', 'Interviewed'] }, offer: null, meritStatus: null },
      data: { status: 'InterviewScheduled' }
    });
    expect(prisma.interviewRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 1, roundNumber: 1, durationMinutes: 45, location: 'Board Room', scheduledById: 9,
        scheduledDate: new Date('2030-10-01T07:00:00Z')
      })
    });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'InterviewScheduled' })
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('sends each panelist with an address a calendar invitation, and the candidate one for their interview', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    const booked = detailedRound({
      panelMembers: [
        { id: 1, name: 'Ann Chair', email: 'ann@example.test', isChair: true },
        { id: 2, name: 'Bob External', email: null }
      ]
    });
    prisma.interviewRound.findMany
      .mockResolvedValueOnce([]) // clash check
      .mockResolvedValueOnce([booked]) // the booked round
      .mockResolvedValueOnce([booked]); // that vacancy's interviews that day, for the panel's meeting
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.count.mockResolvedValue(0);
    prisma.interviewRound.create.mockResolvedValue({ id: 1, applicationId: 1 });

    const res = mockRes();
    await interviewController.schedule({
      params: { applicationId: '1' },
      body: {
        scheduledDate: '2030-10-01T07:00:00Z', mode: 'In-person', location: 'Board Room',
        panelMembers: [{ name: 'Ann Chair', email: 'ann@example.test', isChair: true }, { name: 'Bob External' }]
      },
      user: { id: 9 }
    }, res);

    expect(prisma.panelMember.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: 'Ann Chair', isChair: true, interviewRoundId: 1 }),
        expect.objectContaining({ name: 'Bob External', isChair: false, interviewRoundId: 1 })
      ]
    });
    const panelEmails = sendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === 'ann@example.test');
    expect(panelEmails).toHaveLength(1);
    expect(panelEmails[0].icalEvent.method).toBe('REQUEST');
    expect(panelEmails[0].icalEvent.content).toMatch(/METHOD:REQUEST[\s\S]*BEGIN:VEVENT/);
    expect(panelEmails[0].icalEvent.content).toContain('ATTENDEE;CN="Ann Chair"');
    expect(panelEmails[0].html).not.toMatch(/link|score them/i);
    const toCandidate = sendMail.mock.calls.map((c) => c[0]).find((m) => m.to === 'jane@example.test');
    expect(toCandidate.icalEvent.content).toContain('UID:interview-1@ucaa-erecruitment');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ panelEmailed: 1 }));
  });

  test('refuses a meeting link that is not a web address', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    const res = mockRes();
    await interviewController.schedule({
      params: { applicationId: '1' }, body: { mode: 'Virtual', meetingLink: 'javascript:alert(1)' }, user: { id: 9 }
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('refuses a panel with two chairs', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    const res = mockRes();
    await interviewController.schedule({
      params: { applicationId: '1' },
      body: { panelMembers: [{ name: 'A', isChair: true }, { name: 'B', isChair: true }] },
      user: { id: 9 }
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('reports a panelist double-booking as a 409 with the clash, and books nothing', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    prisma.interviewRound.findMany.mockResolvedValueOnce([
      clashRound({ location: 'Other Room', panelMembers: [{ name: 'Ann Chair', email: 'ANN@example.test', staffUserId: null }] })
    ]);
    const res = mockRes();
    await interviewController.schedule({
      params: { applicationId: '1' },
      body: { scheduledDate: '2030-10-01T07:00:00Z', mode: 'In-person', location: 'Board Room', panelMembers: [{ name: 'Ann', email: 'ann@example.test' }] },
      user: { id: 9 }
    }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SCHEDULE_CONFLICT',
      conflicts: [expect.objectContaining({ type: 'panelist', roundId: 50 })]
    }));
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('allowConflicts books despite a clash, without running the check', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    prisma.interviewRound.findMany.mockResolvedValueOnce([detailedRound()]);
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.count.mockResolvedValue(0);
    prisma.interviewRound.create.mockResolvedValue({ id: 1, applicationId: 1 });
    const res = mockRes();
    await interviewController.schedule({
      params: { applicationId: '1' },
      body: { scheduledDate: '2030-10-01T07:00:00Z', allowConflicts: true },
      user: { id: 9 }
    }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.interviewRound.findMany).toHaveBeenCalledTimes(1);
  });

  test('returns 409 when the application moved on between the check and the booking', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    prisma.interviewRound.findMany.mockResolvedValueOnce([]);
    prisma.application.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await interviewController.schedule({
      params: { applicationId: '1' }, body: { scheduledDate: '2030-10-01T07:00:00Z' }, user: { id: 9 }
    }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });
});

describe('interview sessions (bulk scheduling)', () => {
  const apps = [
    { id: 11, status: 'Shortlisted', candidateId: 101, candidate: { id: 101, fullName: 'Amy' }, offer: null },
    { id: 12, status: 'Shortlisted', candidateId: 102, candidate: { id: 102, fullName: 'Ben' }, offer: null },
    { id: 13, status: 'Shortlisted', candidateId: 103, candidate: { id: 103, fullName: 'Cat' }, offer: null }
  ];
  const body = {
    applicationIds: [12, 11, 13], startsAt: '2030-10-01T06:00:00Z', durationMinutes: 30, gapMinutes: 10,
    mode: 'In-person', location: 'Board Room', panelMembers: [{ name: 'Ann', email: 'ann@example.test', isChair: true }]
  };

  test('plan lays candidates out back to back in the order given, and writes nothing', async () => {
    prisma.application.findMany.mockResolvedValue(apps);
    prisma.interviewRound.findMany.mockResolvedValue([]);
    const res = mockRes();
    await interviewController.planSession({ params: { vacancyId: '3' }, body, user: { id: 9 } }, res);

    const plan = res.json.mock.calls[0][0];
    expect(plan.slots.map((s) => [s.candidateName, s.start.toISOString()])).toEqual([
      ['Ben', '2030-10-01T06:00:00.000Z'],
      ['Amy', '2030-10-01T06:40:00.000Z'],
      ['Cat', '2030-10-01T07:20:00.000Z']
    ]);
    expect(plan.endsAt.toISOString()).toBe('2030-10-01T07:50:00.000Z');
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('plan attaches each clash to the slot it affects', async () => {
    prisma.application.findMany.mockResolvedValue(apps);
    prisma.interviewRound.findMany.mockResolvedValue([
      clashRound({ scheduledDate: new Date('2030-10-01T06:45:00Z'), durationMinutes: 30, location: 'Board Room' })
    ]);
    const res = mockRes();
    await interviewController.planSession({ params: { vacancyId: '3' }, body, user: { id: 9 } }, res);
    const plan = res.json.mock.calls[0][0];
    expect(plan.slots[0].conflicts).toEqual([]);
    expect(plan.slots[1].conflicts).toEqual([expect.objectContaining({ type: 'room' })]);
  });

  test('refuses applications that are not on this vacancy', async () => {
    prisma.application.findMany.mockResolvedValue(apps.slice(0, 2));
    const res = mockRes();
    await interviewController.planSession({ params: { vacancyId: '3' }, body, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('refuses an application that is no longer schedulable, naming it', async () => {
    prisma.application.findMany.mockResolvedValue([apps[0], { ...apps[1], status: 'Rejected' }, apps[2]]);
    const res = mockRes();
    await interviewController.planSession({ params: { vacancyId: '3' }, body, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Ben (Rejected)') });
  });

  test('refuses the same candidate twice', async () => {
    const res = mockRes();
    await interviewController.planSession({ params: { vacancyId: '3' }, body: { ...body, applicationIds: [11, 11] }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('booking a session refuses clashes unless allowConflicts is set', async () => {
    prisma.application.findMany.mockResolvedValue(apps);
    prisma.interviewRound.findMany.mockResolvedValue([clashRound({ scheduledDate: new Date('2030-10-01T06:00:00Z') })]);
    const res = mockRes();
    await interviewController.scheduleSession({ params: { vacancyId: '3' }, body, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.interviewRound.create).not.toHaveBeenCalled();
  });

  test('books every slot in one transaction under one session key, invites each candidate, and gives each panelist ONE meeting for the day', async () => {
    prisma.application.findMany.mockResolvedValue(apps);
    const panel = [{ id: 1, name: 'Ann', email: 'ann@example.test', isChair: true }];
    const booked = [
      detailedRound({ id: 21, applicationId: 12, panelMembers: panel, application: { ...detailedRound().application, candidateId: 102 } }),
      detailedRound({ id: 22, applicationId: 11, panelMembers: panel, application: { ...detailedRound().application, candidateId: 101 } }),
      detailedRound({ id: 23, applicationId: 13, panelMembers: panel, application: { ...detailedRound().application, candidateId: 103 } })
    ];
    prisma.interviewRound.findMany
      .mockResolvedValueOnce([]) // clash check
      .mockResolvedValueOnce(booked)
      .mockResolvedValueOnce(booked); // the day's interviews, for Ann's meeting
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.count.mockResolvedValue(0);
    prisma.interviewRound.create
      .mockResolvedValueOnce({ id: 21 }).mockResolvedValueOnce({ id: 22 }).mockResolvedValueOnce({ id: 23 });

    const res = mockRes();
    await interviewController.scheduleSession({ params: { vacancyId: '3' }, body, user: { id: 9 } }, res);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const created = prisma.interviewRound.create.mock.calls.map((c) => c[0].data);
    expect(created).toHaveLength(3);
    expect(new Set(created.map((d) => d.sessionKey)).size).toBe(1);
    expect(created[0].sessionKey).toMatch(/^s_/);
    expect(created.map((d) => d.applicationId)).toEqual([12, 11, 13]);

    const candidateNotices = prisma.candidateNotification.create.mock.calls
      .map((c) => c[0].data).filter((d) => d.channel === 'InApp' && d.type === 'InterviewScheduled');
    expect(candidateNotices.map((d) => d.candidateId).sort()).toEqual([101, 102, 103]);

    const toAnn = sendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === 'ann@example.test');
    expect(toAnn).toHaveLength(1);
    expect(toAnn[0].icalEvent.content.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(toAnn[0].icalEvent.content).toContain('(3 candidates)');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityType: 'Vacancy', entityId: 3, action: 'Interview session scheduled' })
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('reschedule', () => {
  test('requires the new date and time', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound());
    const res = mockRes();
    await interviewController.reschedule({ params: { interviewId: '1' }, body: {}, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('refuses a round that is no longer Scheduled', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound({ status: 'Cancelled' }));
    const res = mockRes();
    await interviewController.reschedule({ params: { interviewId: '1' }, body: { scheduledDate: '2030-10-02T07:00:00Z' }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  test('moves the round, resets the candidate confirmation and reminder, and tells the candidate', async () => {
    prisma.interviewRound.findUnique
      .mockResolvedValueOnce(detailedRound({ candidateResponse: 'RescheduleRequested' }))
      .mockResolvedValueOnce(detailedRound({ scheduledDate: new Date('2030-10-02T07:00:00Z'), rescheduleCount: 1 }));
    prisma.interviewRound.findMany.mockResolvedValue([]);
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await interviewController.reschedule({
      params: { interviewId: '1' }, body: { scheduledDate: '2030-10-02T07:00:00Z', reason: 'Panel chair travelling' }, user: { id: 9 }
    }, res);

    // The round being moved is never checked against itself.
    expect(prisma.interviewRound.findMany.mock.calls[0][0].where.id).toEqual({ notIn: [1] });
    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'Scheduled' },
      data: expect.objectContaining({
        scheduledDate: new Date('2030-10-02T07:00:00Z'), rescheduleCount: { increment: 1 },
        candidateResponse: 'Pending', reminderSentAt: null, resultsReminderSentAt: null
      })
    });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'InterviewRescheduled', message: expect.stringContaining('Panel chair travelling') })
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'Interview rescheduled', payload: expect.objectContaining({ candidateHadAsked: true }) })
    });
  });
});

describe('cancel', () => {
  test('requires a reason', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound());
    const res = mockRes();
    await interviewController.cancel({ params: { interviewId: '1' }, body: {}, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('cancels, returns the application to Shortlisted and cancels the candidate\'s calendar entry', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound());
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findMany.mockResolvedValue([{ id: 1, status: 'Scheduled', recommendation: null }]);
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await interviewController.cancel({ params: { interviewId: '1' }, body: { reason: 'Vacancy on hold' }, user: { id: 9 } }, res);

    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'Scheduled' },
      data: expect.objectContaining({ status: 'Cancelled', cancelledById: 9, cancellationReason: 'Vacancy on hold' })
    });
    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'InterviewScheduled' }, data: { status: 'Shortlisted' }
    });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'InterviewCancelled' })
    }));
    const toCandidate = sendMail.mock.calls.map((c) => c[0]).find((m) => m.to === 'jane@example.test');
    expect(toCandidate.icalEvent.method).toBe('CANCEL');
    expect(toCandidate.icalEvent.content).toMatch(/STATUS:CANCELLED[\s\S]*SEQUENCE:1|SEQUENCE:1[\s\S]*STATUS:CANCELLED/);
  });

  test('keeps the application at InterviewScheduled when another round is still coming up', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound());
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findMany.mockResolvedValue([
      { id: 1, status: 'Scheduled', recommendation: null },
      { id: 2, status: 'Scheduled', recommendation: null }
    ]);
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await interviewController.cancel({ params: { interviewId: '1' }, body: { reason: 'Duplicate', notifyCandidate: false }, user: { id: 9 } }, res);
    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'InterviewScheduled' }, data: { status: 'InterviewScheduled' }
    });
    expect(prisma.candidateNotification.create).not.toHaveBeenCalled();
  });
});

describe('markNoShow', () => {
  test('refuses before the interview time', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound({ scheduledDate: new Date(Date.now() + 3600000) }));
    const res = mockRes();
    await interviewController.markNoShow({ params: { interviewId: '1' }, body: {}, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('records the no-show and returns the application to Interviewed when an earlier round was finalized', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound({ id: 2, roundNumber: 2, scheduledDate: new Date(Date.now() - 3600000) }));
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findMany.mockResolvedValue([
      { id: 1, status: 'Completed', recommendation: 'Hold' },
      { id: 2, status: 'Scheduled', recommendation: null }
    ]);
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await interviewController.markNoShow({ params: { interviewId: '2' }, body: {}, user: { id: 9 } }, res);
    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({ where: { id: 2, status: 'Scheduled' }, data: { status: 'NoShow' } });
    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'InterviewScheduled' }, data: { status: 'Interviewed' }
    });
  });
});

describe('panel management', () => {
  const scheduledRound = { id: 1, status: 'Scheduled', applicationId: 1 };

  test('removing a panelist cancels their calendar meeting when it was their only interview that day', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({
      id: 4, name: 'Ann', email: 'ann@example.test', interviewRoundId: 1, interviewRound: scheduledRound
    });
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound({ panelMembers: [{ id: 4, name: 'Ann', email: 'ann@example.test' }] }));
    prisma.interviewRound.findMany.mockResolvedValue([detailedRound({ panelMembers: [] })]); // the day, after removal
    const res = mockRes();
    await interviewController.removePanelMember({ params: { panelMemberId: '4' }, body: {}, query: {}, user: { id: 9 } }, res);
    expect(prisma.panelMember.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    const toAnn = sendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === 'ann@example.test');
    expect(toAnn).toHaveLength(1);
    expect(toAnn[0].icalEvent.method).toBe('CANCEL');
    expect(toAnn[0].subject).toMatch(/cancelled/i);
  });

  test('adding a panelist invites only them', async () => {
    const round = detailedRound({ panelMembers: [{ id: 1, name: 'Ann', email: 'ann@example.test' }] });
    prisma.interviewRound.findUnique
      .mockResolvedValueOnce(round)
      .mockResolvedValueOnce({ ...round, panelMembers: [...round.panelMembers, { id: 2, name: 'Bea', email: 'bea@example.test' }] });
    prisma.interviewRound.findMany
      .mockResolvedValueOnce([]) // clash check
      .mockResolvedValueOnce([{ ...round, panelMembers: [...round.panelMembers, { id: 2, name: 'Bea', email: 'bea@example.test' }] }]);
    prisma.panelMember.create.mockResolvedValue({ id: 2, name: 'Bea', email: 'bea@example.test' });
    const res = mockRes();
    await interviewController.addPanelMember({ params: { interviewId: '1' }, body: { name: 'Bea', email: 'bea@example.test' }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(['bea@example.test']);
  });

  test('adding someone already on the panel is refused', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound({ panelMembers: [{ id: 1, name: 'Ann', email: 'ann@example.test' }] }));
    const res = mockRes();
    await interviewController.addPanelMember({ params: { interviewId: '1' }, body: { name: 'Ann B', email: 'Ann@Example.test' }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.panelMember.create).not.toHaveBeenCalled();
  });

  test('making someone chair clears the previous chair', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, name: 'Ann', interviewRoundId: 1, interviewRound: scheduledRound });
    prisma.panelMember.update.mockResolvedValue({ id: 4, isChair: true });
    const res = mockRes();
    await interviewController.updatePanelMember({ params: { panelMemberId: '4' }, body: { isChair: true }, user: { id: 9 } }, res);
    expect(prisma.panelMember.updateMany).toHaveBeenCalledWith({ where: { interviewRoundId: 1, isChair: true }, data: { isChair: false } });
    expect(prisma.panelMember.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { isChair: true } });
  });
});

describe('recordResults', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const held = new Date(Date.now() - 2 * 3600000);

  // An uploaded score sheet as multer hands it over (on disk).
  function sheet() {
    const file = path.join(os.tmpdir(), `sheet-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
    fs.writeFileSync(file, '%PDF-1.4 signed sheet');
    return { path: file, filename: path.basename(file), originalname: 'Panel score sheet - Jane Doe.pdf' };
  }
  const call = async (body, { round = detailedRound({ scheduledDate: held }), file = sheet(), application } = {}) => {
    prisma.interviewRound.findUnique.mockResolvedValue(round);
    prisma.application.findUnique.mockResolvedValue(application || { id: 1, status: 'InterviewScheduled', meritStatus: null, offer: null });
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.application.update.mockResolvedValue({ id: 1, candidateId: 5, vacancy: { title: 'Air Traffic Controller' } });
    const res = mockRes();
    await interviewController.recordResults({ params: { interviewId: '1' }, body, file, user: { id: 9, type: 'staff' } }, res);
    return { res, file };
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  test('records the panel\'s score, verdict and signed sheet, completes the round and moves the application to Interviewed', async () => {
    const { res, file } = await call({ score: '72.46', recommendation: 'Shortlist', notes: 'Strong on procedures' });
    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'Scheduled' },
      data: expect.objectContaining({
        score: 72.5, recommendation: 'Shortlist', resultNotes: 'Strong on procedures', conductedById: 9,
        status: 'Completed', scoreSheetUrl: `/api/files/${file.filename}`, scoreSheetName: 'Panel score sheet - Jane Doe.pdf'
      })
    });
    expect(prisma.application.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: { status: 'Interviewed' } }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'Interview results recorded' }) });
    expect(res.status).not.toHaveBeenCalled();
    expect(fs.existsSync(file.path)).toBe(true);
    fs.rmSync(file.path, { force: true });
  });

  test('a "Reject" verdict rejects the application and tells the candidate', async () => {
    const { file } = await call({ score: '41', recommendation: 'Reject' });
    expect(prisma.application.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Rejected', rejectedById: 9, rank: null, meritStatus: null })
    }));
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'ApplicationRejected' })
    }));
    fs.rmSync(file.path, { force: true });
  });

  test.each([
    [{ score: '', recommendation: 'Shortlist' }, 400, /overall score/],
    [{ score: '101', recommendation: 'Shortlist' }, 400, /0 to 100/],
    [{ score: 'abc', recommendation: 'Shortlist' }, 400, /0 to 100/],
    [{ score: '70', recommendation: 'Maybe' }, 400, /verdict/]
  ])('refuses %p, and does not keep the uploaded sheet', async (body, status, message) => {
    const { res, file } = await call(body);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json.mock.calls[0][0].error).toMatch(message);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
    await settle();
    expect(fs.existsSync(file.path)).toBe(false);
  });

  test('the signed score sheet is required the first time', async () => {
    const { res } = await call({ score: '70', recommendation: 'Hold' }, { file: null });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/signed score sheet/);
  });

  test('not before the interview has taken place, nor for one that did not go ahead', async () => {
    let { res } = await call({ score: '70', recommendation: 'Hold' }, { round: detailedRound({ scheduledDate: new Date(Date.now() + 3600000) }) });
    expect(res.status).toHaveBeenCalledWith(422);
    ({ res } = await call({ score: '70', recommendation: 'Hold' }, { round: detailedRound({ scheduledDate: held, status: 'NoShow' }) }));
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test.each(['Rejected', 'Offered', 'Withdrawn'])('refuses when the application has already moved on (%s)', async (status) => {
    const { res } = await call({ score: '70', recommendation: 'Hold' }, { application: { id: 1, status, meritStatus: null, offer: null } });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  test('two people recording at once: the second is refused', async () => {
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 0 });
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound({ scheduledDate: held }));
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'InterviewScheduled', meritStatus: null, offer: null });
    const res = mockRes();
    await interviewController.recordResults({ params: { interviewId: '1' }, body: { score: '70', recommendation: 'Hold' }, file: sheet(), user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  describe('correcting results', () => {
    const completed = detailedRound({ scheduledDate: held, status: 'Completed', score: 64, recommendation: 'Hold', scoreSheetName: 'old.pdf' });
    const interviewed = { id: 1, status: 'Interviewed', meritStatus: null, offer: null };

    test('changes the score and verdict (Hold to Shortlist) without a new sheet, and audits before and after', async () => {
      const { res } = await call({ score: '68', recommendation: 'Shortlist' }, { round: completed, file: null, application: interviewed });
      expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'Completed' },
        data: expect.objectContaining({ score: 68, recommendation: 'Shortlist' })
      });
      expect(prisma.interviewRound.updateMany.mock.calls[0][0].data).not.toHaveProperty('scoreSheetUrl');
      expect(prisma.application.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        action: 'Interview results corrected',
        payload: expect.objectContaining({ before: expect.objectContaining({ score: 64, recommendation: 'Hold' }), after: expect.objectContaining({ score: 68 }) })
      }) });
      expect(res.status).not.toHaveBeenCalled();
    });

    test('not once the candidate is on the merit list', async () => {
      const { res } = await call({ score: '68', recommendation: 'Hold' }, { round: completed, file: null, application: { ...interviewed, meritStatus: 'Proposed' } });
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].error).toMatch(/merit list/);
    });

    test('a rejection is final, and a result can\'t be corrected into one', async () => {
      let { res } = await call({ score: '50', recommendation: 'Hold' }, { round: { ...completed, recommendation: 'Reject' }, file: null, application: interviewed });
      expect(res.status).toHaveBeenCalledWith(409);
      ({ res } = await call({ score: '50', recommendation: 'Reject' }, { round: completed, file: null, application: interviewed }));
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });
});

describe('attention', () => {
  test('buckets open rounds by what they are waiting on', async () => {
    const past = new Date(Date.now() - 2 * 3600000);
    const soon = new Date(Date.now() + 24 * 3600000);
    prisma.interviewRound.findMany.mockResolvedValue([
      detailedRound({ id: 1, scheduledDate: past, panelMembers: [{ id: 1, name: 'Ann' }] }),
      detailedRound({ id: 3, scheduledDate: soon, panelMembers: [{ id: 4, name: 'Bob' }] }),
      detailedRound({ id: 4, scheduledDate: soon, candidateResponse: 'RescheduleRequested', panelMembers: [] }),
      detailedRound({ id: 5, scheduledDate: null, panelMembers: [{ id: 5, name: 'Cy' }] })
    ]);
    prisma.application.findMany.mockResolvedValue([
      { id: 8, vacancy: { id: 3, jobRef: 'A', title: 'ATC' } },
      { id: 9, vacancy: { id: 3, jobRef: 'A', title: 'ATC' } }
    ]);
    const res = mockRes();
    await interviewController.attention({ query: {}, user: { id: 9 } }, res);
    const body = res.json.mock.calls[0][0];
    const ids = (k) => body[k].map((r) => r.id);
    expect(ids('awaitingResults')).toEqual([1]);
    expect(body.awaitingResults[0].resultsDue).toBe(true);
    expect(ids('unconfirmed')).toEqual([3]);
    expect(ids('rescheduleRequests')).toEqual([4]);
    expect(ids('noDate')).toEqual([5]);
    expect(ids('noPanel')).toEqual([4]);
    expect(body).not.toHaveProperty('awaitingScores');
    expect(body.awaitingScheduling).toEqual([expect.objectContaining({ id: 3, count: 2 })]);
  });
});
