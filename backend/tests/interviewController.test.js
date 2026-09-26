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
    criteria: null, rescheduleCount: 0, candidateResponse: 'Pending', scheduledById: 9,
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
      where: { id: 1, status: { in: ['Shortlisted', 'InterviewScheduled', 'Interviewed'] }, offer: null },
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

  test('emails each panelist with an address a calendar invite', async () => {
    prisma.application.findUnique.mockResolvedValue(schedulable);
    prisma.interviewRound.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([detailedRound({
        panelMembers: [
          { id: 1, name: 'Ann Chair', email: 'ann@example.test', isChair: true },
          { id: 2, name: 'Bob External', email: null }
        ]
      })]);
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
    expect(panelEmails[0].attachments[0].content).toContain('BEGIN:VEVENT');
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

  test('books every slot in one transaction under one session key, notifies each candidate, and sends each panelist ONE email', async () => {
    prisma.application.findMany.mockResolvedValue(apps);
    const panel = [{ id: 1, name: 'Ann', email: 'ann@example.test', isChair: true }];
    const booked = [
      detailedRound({ id: 21, applicationId: 12, panelMembers: panel, application: { ...detailedRound().application, candidateId: 102 } }),
      detailedRound({ id: 22, applicationId: 11, panelMembers: panel, application: { ...detailedRound().application, candidateId: 101 } }),
      detailedRound({ id: 23, applicationId: 13, panelMembers: panel, application: { ...detailedRound().application, candidateId: 103 } })
    ];
    prisma.interviewRound.findMany
      .mockResolvedValueOnce([]) // clash check
      .mockResolvedValueOnce(booked);
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
    expect(toAnn[0].attachments[0].content.match(/BEGIN:VEVENT/g)).toHaveLength(3);
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
        candidateResponse: 'Pending', reminderSentAt: null
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

  test('cancels, revokes scoring links, returns the application to Shortlisted and tells the candidate', async () => {
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
    expect(prisma.panelAccessToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { usedAt: null, panelMember: { interviewRoundId: 1 } }
    }));
    expect(prisma.application.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'InterviewScheduled' }, data: { status: 'Shortlisted' }
    });
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'InterviewCancelled' })
    }));
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

  test('recusal requires a reason', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, name: 'Ann', interviewRoundId: 1, interviewRound: scheduledRound });
    const res = mockRes();
    await interviewController.recusePanelMember({ params: { panelMemberId: '4' }, body: {}, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('a recused panelist stops counting towards the round average', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, name: 'Ann', score: 20, interviewRoundId: 1, interviewRound: scheduledRound });
    prisma.panelMember.findMany.mockResolvedValue([
      { id: 4, score: 20, recusedAt: new Date() },
      { id: 5, score: 80, recusedAt: null }
    ]);
    const res = mockRes();
    await interviewController.recusePanelMember({ params: { panelMemberId: '4' }, body: { reason: 'Related to the candidate' }, user: { id: 9 } }, res);
    expect(prisma.panelMember.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: expect.objectContaining({ recusalReason: 'Related to the candidate', isChair: false })
    });
    expect(prisma.interviewRound.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { score: 80 } });
  });

  test('a panelist who has scored can be recused but not removed', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 4, name: 'Ann', score: 70, interviewRoundId: 1, interviewRound: scheduledRound });
    const res = mockRes();
    await interviewController.removePanelMember({ params: { panelMemberId: '4' }, body: {}, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.panelMember.delete).not.toHaveBeenCalled();
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

describe('finalizeRecommendation', () => {
  test('rejects an invalid interview round id', async () => {
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: 'abc' }, body: { recommendation: 'Shortlist' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a recommendation that is not Shortlist/Hold/Reject', async () => {
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Maybe' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  test('returns 422 when no panel member has scored yet', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: null }]);
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Shortlist' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  test('a score from a recused panelist does not count as panel input', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88, recusedAt: new Date() }]);
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Shortlist' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('returns 404 when the interview round does not exist', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
    prisma.interviewRound.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  test('refuses a cancelled round', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
    prisma.interviewRound.findUnique.mockResolvedValue({ id: 1, applicationId: 1, status: 'Cancelled', recommendation: null });
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
  });

  // Guards against finalizing a stale round after its application already
  // moved on elsewhere since it was scheduled.
  test.each(['Rejected', 'Offered', 'Draft', 'Withdrawn'])(
    'refuses to finalize when the application is already at status %s (stale round)',
    async (status) => {
      prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
      prisma.interviewRound.findUnique.mockResolvedValue({ id: 1, applicationId: 1, recommendation: null, status: 'Scheduled' });
      prisma.application.findUnique.mockResolvedValue({ id: 1, status });
      const res = mockRes();
      await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } }, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(prisma.interviewRound.updateMany).not.toHaveBeenCalled();
    }
  );

  test('returns 409 when this round already has a finalized recommendation (double-finalize/race)', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
    prisma.interviewRound.findUnique.mockResolvedValue({ id: 1, applicationId: 1, recommendation: null, status: 'Scheduled' });
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'InterviewScheduled' });
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('a "Shortlist" recommendation completes the round, closes scoring links and moves the application to Interviewed', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 88 }]);
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'InterviewScheduled' });
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findUnique.mockResolvedValue({ id: 1, applicationId: 1, recommendation: 'Shortlist', status: 'Scheduled' });
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Shortlist' }, user: { id: 9 } }, res);

    expect(prisma.interviewRound.updateMany).toHaveBeenCalledWith({
      where: { id: 1, recommendation: null },
      data: expect.objectContaining({ recommendation: 'Shortlist', conductedById: 9, status: 'Completed', completedAt: expect.any(Date) })
    });
    expect(prisma.panelAccessToken.updateMany).toHaveBeenCalled();
    expect(prisma.application.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'Interviewed' } });
  });

  test('a "Reject" recommendation rejects the application, clears its rank, and notifies the candidate', async () => {
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 40 }]);
    prisma.application.findUnique.mockResolvedValue({ id: 1, status: 'Interviewed' });
    prisma.interviewRound.updateMany.mockResolvedValue({ count: 1 });
    prisma.interviewRound.findUnique.mockResolvedValue({ id: 1, applicationId: 1, recommendation: 'Reject', status: 'Scheduled' });
    prisma.application.update.mockResolvedValue({ id: 1, candidateId: 5, vacancy: { title: 'Air Traffic Controller' } });
    const res = mockRes();
    await interviewController.finalizeRecommendation({ params: { interviewId: '1' }, body: { recommendation: 'Reject' }, user: { id: 9 } }, res);

    expect(prisma.application.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'Rejected', rejectedById: 9, rank: null, listStatus: null })
    }));
    expect(prisma.candidateNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateId: 5, type: 'ApplicationRejected' })
    }));
  });
});

describe('recordPanelScore', () => {
  const round = { id: 5, status: 'Scheduled', criteria: null };

  test('rejects an invalid panel member id', async () => {
    const res = mockRes();
    await interviewController.recordPanelScore({ params: { panelMemberId: 'abc' }, body: { score: 80 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test.each([-1, 101, NaN, 'not-a-number', ''])('rejects an out-of-range/non-numeric score (%p)', async (score) => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 1, interviewRoundId: 5, interviewRound: round });
    const res = mockRes();
    await interviewController.recordPanelScore({ params: { panelMemberId: '1' }, body: { score }, user: { id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.panelMember.update).not.toHaveBeenCalled();
  });

  test('returns 404 when the panel member does not exist', async () => {
    prisma.panelMember.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await interviewController.recordPanelScore({ params: { panelMemberId: '99' }, body: { score: 80 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('records a valid score and closes the panelist\'s outstanding link', async () => {
    prisma.panelMember.findUnique.mockResolvedValue({ id: 1, interviewRoundId: 5, interviewRound: round });
    prisma.panelMember.update.mockResolvedValue({ id: 1, score: 80, interviewRoundId: 5 });
    prisma.panelMember.findMany.mockResolvedValue([{ id: 1, score: 80 }]);
    const res = mockRes();
    await interviewController.recordPanelScore({ params: { panelMemberId: '1' }, body: { score: 80, comments: 'Good' }, user: { id: 9 } }, res);

    expect(prisma.panelMember.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ score: 80, comments: 'Good', recordedById: 9 })
    }));
    expect(prisma.panelAccessToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { panelMemberId: 1, usedAt: null } }));
    expect(res.json).toHaveBeenCalled();
  });

  test('with a rubric, computes the score from the per-criterion ratings', async () => {
    const criteria = [{ id: 'c_aaaa1111', name: 'Technical', weight: 3 }, { id: 'c_bbbb2222', name: 'Communication', weight: 1 }];
    prisma.panelMember.findUnique.mockResolvedValue({ id: 1, interviewRoundId: 5, interviewRound: { ...round, criteria } });
    prisma.panelMember.update.mockResolvedValue({ id: 1, interviewRoundId: 5 });
    prisma.panelMember.findMany.mockResolvedValue([]);
    const res = mockRes();
    await interviewController.recordPanelScore({
      params: { panelMemberId: '1' }, body: { score: 1, criterionScores: { c_aaaa1111: 5, c_bbbb2222: 1 } }, user: { id: 9 }
    }, res);
    // (3 * 5/5 + 1 * 1/5) / 4 = 0.8
    expect(prisma.panelMember.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ score: 80, criterionScores: { c_aaaa1111: 5, c_bbbb2222: 1 } })
    }));
  });

  test('with a rubric, refuses a scoresheet with a criterion left unrated', async () => {
    const criteria = [{ id: 'c_aaaa1111', name: 'Technical', weight: 3 }, { id: 'c_bbbb2222', name: 'Communication', weight: 1 }];
    prisma.panelMember.findUnique.mockResolvedValue({ id: 1, interviewRoundId: 5, interviewRound: { ...round, criteria } });
    const res = mockRes();
    await interviewController.recordPanelScore({
      params: { panelMemberId: '1' }, body: { criterionScores: { c_aaaa1111: 5 } }, user: { id: 9 }
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Communication') });
  });

  test('refuses to score a round that did not go ahead, or a recused panelist', async () => {
    prisma.panelMember.findUnique.mockResolvedValueOnce({ id: 1, interviewRound: { ...round, status: 'NoShow' } });
    const res1 = mockRes();
    await interviewController.recordPanelScore({ params: { panelMemberId: '1' }, body: { score: 50 }, user: { id: 9 } }, res1);
    expect(res1.status).toHaveBeenCalledWith(409);

    prisma.panelMember.findUnique.mockResolvedValueOnce({ id: 1, name: 'Ann', recusedAt: new Date(), interviewRound: round });
    const res2 = mockRes();
    await interviewController.recordPanelScore({ params: { panelMemberId: '1' }, body: { score: 50 }, user: { id: 9 } }, res2);
    expect(res2.status).toHaveBeenCalledWith(409);
    expect(prisma.panelMember.update).not.toHaveBeenCalled();
  });
});

describe('sendAllLinks', () => {
  test('issues a link to every panelist who has not scored, returning the url only for those without an email', async () => {
    prisma.interviewRound.findUnique.mockResolvedValue(detailedRound({
      panelMembers: [
        { id: 1, name: 'Ann', email: 'ann@example.test', score: null },
        { id: 2, name: 'Bob', email: null, score: null },
        { id: 3, name: 'Cy', email: 'cy@example.test', score: 70 },
        { id: 4, name: 'Di', email: 'di@example.test', score: null, recusedAt: new Date() }
      ]
    }));
    sendMail.mockResolvedValue({ messageId: 'x' });
    const res = mockRes();
    await interviewController.sendAllLinks({ params: { interviewId: '1' }, body: {}, user: { id: 9 } }, res);

    const { results } = res.json.mock.calls[0][0];
    expect(results.map((r) => r.name)).toEqual(['Ann', 'Bob']);
    expect(results[0]).toEqual(expect.objectContaining({ emailed: true, url: undefined }));
    expect(results[1]).toEqual(expect.objectContaining({ emailed: false, url: expect.stringContaining('/panel-score/') }));
    expect(prisma.panelAccessToken.create).toHaveBeenCalledTimes(2);
  });
});

describe('attention', () => {
  test('buckets open rounds by what they are waiting on', async () => {
    const past = new Date(Date.now() - 2 * 3600000);
    const soon = new Date(Date.now() + 24 * 3600000);
    prisma.interviewRound.findMany.mockResolvedValue([
      detailedRound({ id: 1, scheduledDate: past, panelMembers: [{ id: 1, score: 70 }, { id: 2, score: null }] }),
      detailedRound({ id: 2, scheduledDate: past, panelMembers: [{ id: 3, score: 70 }] }),
      detailedRound({ id: 3, scheduledDate: soon, panelMembers: [{ id: 4, score: null }] }),
      detailedRound({ id: 4, scheduledDate: soon, candidateResponse: 'RescheduleRequested', panelMembers: [] }),
      detailedRound({ id: 5, scheduledDate: null, panelMembers: [{ id: 5, score: null }] })
    ]);
    prisma.application.findMany.mockResolvedValue([
      { id: 8, vacancy: { id: 3, jobRef: 'A', title: 'ATC' } },
      { id: 9, vacancy: { id: 3, jobRef: 'A', title: 'ATC' } }
    ]);
    const res = mockRes();
    await interviewController.attention({ query: {}, user: { id: 9 } }, res);
    const body = res.json.mock.calls[0][0];
    const ids = (k) => body[k].map((r) => r.id);
    expect(ids('awaitingScores')).toEqual([1]);
    expect(ids('readyToFinalize')).toEqual([2]);
    expect(ids('unconfirmed')).toEqual([3]);
    expect(ids('rescheduleRequests')).toEqual([4]);
    expect(ids('noDate')).toEqual([5]);
    expect(ids('noPanel')).toEqual([4]);
    expect(body.awaitingScheduling).toEqual([expect.objectContaining({ id: 3, count: 2 })]);
  });
});
