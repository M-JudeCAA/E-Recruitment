jest.mock('../src/config/db', () => require('./__mocks__/db'));

const prisma = require('../src/config/db');
const vacancyController = require('../src/controllers/vacancyController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Two "CWG" positions in genuinely different department rows (same name,
// different directorate/departmentId) - the exact ambiguity this whole
// feature exists to get right.
const cwgCorpDept = { id: 1, name: 'CWG', directorateId: 10, directorate: { id: 10, name: 'CORP' } };
const cwgDansDept = { id: 2, name: 'CWG', directorateId: 20, directorate: { id: 20, name: 'DANS' } };

const officerCorp = { id: 100, name: 'CWG Officer', departmentId: 1, level: 1, department: cwgCorpDept };
const seniorCorp = { id: 101, name: 'CWG Senior Officer', departmentId: 1, level: 2, department: cwgCorpDept };
const equalCorp = { id: 102, name: 'CWG Officer II', departmentId: 1, level: 1, department: cwgCorpDept };
const juniorCorp = { id: 103, name: 'CWG Assistant', departmentId: 1, level: 0, department: cwgCorpDept };
const seniorDans = { id: 200, name: 'CWG Director', departmentId: 2, level: 5, department: cwgDansDept };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.vacancy.count.mockResolvedValue(0); // no jobRef collision by default
});

describe('create', () => {
  test('rejects when positionId does not resolve to a real position', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    const req = { body: { positionId: '999' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('rejects invalid positionsRequired even with a valid position', async () => {
    prisma.position.findUnique.mockResolvedValue(officerCorp);
    const req = { body: { positionId: '100', positionsRequired: -1 }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('derives title and departmentId from the position; defaults positionsRequired to 1; generates a jobRef', async () => {
    prisma.position.findUnique.mockResolvedValue(officerCorp);
    prisma.vacancy.create.mockResolvedValue({ id: 1 });
    const req = { body: { positionId: '100', postingType: 'External' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(prisma.vacancy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'CWG Officer', positionId: 100, departmentId: 1, positionsRequired: 1,
        jobRef: expect.stringMatching(/^UCAA\/ADV\/EXT\/\d{2}\/\d{4}$/)
      })
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  // Regression test for the actual bug this fix exists for: status was
  // never set at all, so every vacancy silently defaulted to 'Open' and
  // was immediately visible to candidates, bypassing approval.
  test('always creates a vacancy as PendingApproval, never defaulting to Open', async () => {
    prisma.position.findUnique.mockResolvedValue(officerCorp);
    prisma.vacancy.create.mockResolvedValue({ id: 1 });
    const req = { body: { positionId: '100', postingType: 'External' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(prisma.vacancy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PendingApproval' })
    }));
  });

  // postingType is now required, with no 'Open' fallback to reach for -
  // HR must choose Internal or External explicitly.
  test('rejects creation with no postingType', async () => {
    prisma.position.findUnique.mockResolvedValue(officerCorp);
    const req = { body: { positionId: '100' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('appends a distinguishing suffix on a same-type, same-month jobRef collision', async () => {
    prisma.position.findUnique.mockResolvedValue(officerCorp);
    prisma.vacancy.count.mockResolvedValue(1); // one already exists with this prefix
    prisma.vacancy.create.mockResolvedValue({ id: 1 });
    const req = { body: { positionId: '100', postingType: 'External' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    const data = prisma.vacancy.create.mock.calls[0][0].data;
    expect(data.jobRef).toMatch(/^UCAA\/ADV\/EXT\/\d{2}\/\d{4}-2$/);
  });

  test('sanitizes the jobPurpose on create', async () => {
    prisma.position.findUnique.mockResolvedValue(officerCorp);
    prisma.vacancy.create.mockResolvedValue({ id: 1 });
    const req = { body: { positionId: '100', postingType: 'External', jobPurpose: '<p>ok</p><script>alert(1)</script>' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    const data = prisma.vacancy.create.mock.calls[0][0].data;
    expect(data.jobPurpose).toBe('<p>ok</p>');
  });

  test('rejects a Reports To position in a different department, even with an identical department name (the CWG case)', async () => {
    prisma.position.findUnique.mockImplementation(({ where: { id } }) => {
      if (id === 100) return Promise.resolve(officerCorp);
      if (id === 200) return Promise.resolve(seniorDans);
      return Promise.resolve(null);
    });
    const req = { body: { positionId: '100', postingType: 'External', reportsToPositionId: '200' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'The selected "Reports To" position must be in the same department' });
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('accepts a genuinely senior Reports To position in the true same department row', async () => {
    prisma.position.findUnique.mockImplementation(({ where: { id } }) => {
      if (id === 100) return Promise.resolve(officerCorp);
      if (id === 101) return Promise.resolve(seniorCorp);
      return Promise.resolve(null);
    });
    prisma.vacancy.create.mockResolvedValue({ id: 1 });
    const req = { body: { positionId: '100', postingType: 'External', reportsToPositionId: '101' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(prisma.vacancy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reportsToPositionId: 101 })
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('rejects an equal-level Reports To position', async () => {
    prisma.position.findUnique.mockImplementation(({ where: { id } }) => {
      if (id === 100) return Promise.resolve(officerCorp);
      if (id === 102) return Promise.resolve(equalCorp);
      return Promise.resolve(null);
    });
    const req = { body: { positionId: '100', postingType: 'External', reportsToPositionId: '102' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('rejects a lower-level Reports To position', async () => {
    prisma.position.findUnique.mockImplementation(({ where: { id } }) => {
      if (id === 100) return Promise.resolve(officerCorp);
      if (id === 103) return Promise.resolve(juniorCorp);
      return Promise.resolve(null);
    });
    const req = { body: { positionId: '100', postingType: 'External', reportsToPositionId: '103' }, user: { id: 1 } };
    const res = mockRes();

    await vacancyController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const req = { params: { id: '99' }, body: {} };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('rejects invalid positionsRequired with 400', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionId: 100, positionsRequired: 2 });
    const req = { params: { id: '1' }, body: { positionsRequired: 0 } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  // positionId/departmentId/reportsToPositionId/jobRef are fixed at
  // creation now - update() doesn't even read positionId from the body,
  // so silently passing one has no effect. Title stays as the original snapshot.
  test('ignores a positionId in the payload - position/title/department are immutable after creation', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionId: 100, title: 'CWG Officer', positionsRequired: 1 });
    prisma.vacancy.update.mockResolvedValue({ id: 1 });
    const req = { params: { id: '1' }, body: { positionId: '999', postingType: 'Internal' } };
    const res = mockRes();

    await vacancyController.update(req, res);

    const data = prisma.vacancy.update.mock.calls[0][0].data;
    expect(data.positionId).toBeUndefined();
    expect(data.title).toBeUndefined();
    expect(data.postingType).toBe('Internal');
    expect(prisma.position.findUnique).not.toHaveBeenCalled();
  });

  test('rejects reducing positionsRequired below the number of accepted offers', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionId: 100, positionsRequired: 3 });
    prisma.offer.count.mockResolvedValue(2);
    const req = { params: { id: '1' }, body: { positionsRequired: 1 } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('updates salaryScale, deadline, and other editable fields', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionId: 100, positionsRequired: 1 });
    prisma.vacancy.update.mockResolvedValue({ id: 1 });
    const req = { params: { id: '1' }, body: { salaryScale: 'Scale 5', deadline: '2099-01-01', category: 'Technical' } };
    const res = mockRes();

    await vacancyController.update(req, res);

    expect(prisma.vacancy.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
      salaryScale: 'Scale 5', category: 'Technical'
    }));
  });

  test('sanitizes the jobPurpose on update', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionId: 100, positionsRequired: 1 });
    prisma.vacancy.update.mockResolvedValue({ id: 1 });
    const req = { params: { id: '1' }, body: { jobPurpose: '<b>ok</b><script>x()</script>' } };
    const res = mockRes();

    await vacancyController.update(req, res);

    const data = prisma.vacancy.update.mock.calls[0][0].data;
    expect(data.jobPurpose).toBe('<b>ok</b>');
  });
});

describe('close', () => {
  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    await vacancyController.close({ params: { id: '99' } }, mockRes());
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('returns 422 if the vacancy is already closed', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Closed' });
    const res = mockRes();
    await vacancyController.close({ params: { id: '1' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('transitions an open vacancy to Closed', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open' });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Closed' });
    await vacancyController.close({ params: { id: '1' } }, mockRes());
    expect(prisma.vacancy.update.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: { id: 1 }, data: { status: 'Closed' }
    }));
  });
});

describe('approve', () => {
  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await vacancyController.approve({ params: { id: '99' }, user: { id: 2 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test.each(['Open', 'PartiallyFilled', 'Filled'])(
    'refuses to approve a vacancy already %s - it does not need approval right now', async (status) => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status, createdById: 5 });
      const res = mockRes();
      await vacancyController.approve({ params: { id: '1' }, user: { id: 2 } }, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });

  test.each(['PendingApproval', 'Closed'])(
    'allows a Manager/Director to approve a %s vacancy directly - no review step in the 2-tier flow', async (status) => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status, createdById: 5 });
      prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open' });
      const res = mockRes();
      await vacancyController.approve({ params: { id: '1' }, user: { id: 2, role: 'Manager' } }, res);
      expect(res.status).not.toHaveBeenCalledWith(422);
      expect(prisma.vacancy.update).toHaveBeenCalled();
    });

  test('refuses to approve a vacancy whose deadline has already passed', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'PendingApproval', createdById: 5, deadline: new Date('2000-01-01') });
    const res = mockRes();
    await vacancyController.approve({ params: { id: '1' }, user: { id: 2, role: 'Manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('allows approving a vacancy with a future deadline', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'PendingApproval', createdById: 5, deadline: new Date('2999-01-01') });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open' });
    const res = mockRes();
    await vacancyController.approve({ params: { id: '1' }, user: { id: 2, role: 'Manager' } }, res);
    expect(prisma.vacancy.update).toHaveBeenCalled();
  });

  test('blocks self-approval - the creator cannot approve their own vacancy', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'PendingApproval', createdById: 2 });
    const res = mockRes();
    await vacancyController.approve({ params: { id: '1' }, user: { id: 2, role: 'Manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  // approvedByRole snapshots which of the two (Manager or Director)
  // actually approved, at the moment they did - unaffected by a later
  // promotion.
  test.each(['Manager', 'Director'])(
    'approving as %s sets approvedAt/approvedById/approvedByRole and resolves any active VacancyApproval escalation', async (role) => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'PendingApproval', createdById: 5 });
      prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open' });
      const res = mockRes();

      await vacancyController.approve({ params: { id: '1' }, user: { id: 2, role } }, res);

      expect(prisma.vacancy.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'Open', approvedById: 2, approvedByRole: role, approvedAt: expect.any(Date) })
      }));
      expect(prisma.taskEscalation.updateMany).toHaveBeenCalledWith({
        where: { taskType: 'VacancyApproval', taskId: 1, resolvedAt: null },
        data: { resolvedAt: expect.any(Date) }
      });
      expect(res.json).toHaveBeenCalledWith({ id: 1, status: 'Open' });
    });
});

describe('transitionPostingType', () => {
  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await vacancyController.transitionPostingType({ params: { id: '99' }, body: { postingType: 'External' }, user: { id: 2, role: 'Manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('rejects a postingType that is not Internal or External', async () => {
    const res = mockRes();
    await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: 'Bogus' }, user: { id: 2, role: 'Manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.findUnique).not.toHaveBeenCalled();
  });

  test.each(['PendingApproval', 'Closed'])(
    'refuses to transition a %s vacancy - only an actively open vacancy can transition', async (status) => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status, postingType: 'Internal' });
      const res = mockRes();
      await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: 'External' }, user: { id: 2, role: 'Manager' } }, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });

  test('refuses a same-value no-op transition', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal' });
    const res = mockRes();
    await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: 'Internal' }, user: { id: 2, role: 'Manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test.each([['Internal', 'External'], ['External', 'Internal']])(
    'transitions a %s vacancy to %s, snapshotting the previous value, actor, and role, and audits it', async (from, to) => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: from });
      prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open', postingType: to });
      const res = mockRes();

      await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: to }, user: { id: 2, role: 'Director' } }, res);

      expect(prisma.vacancy.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          postingType: to, postingTypePreviousValue: from,
          postingTypeChangedById: 2, postingTypeChangedByRole: 'Director', postingTypeChangedAt: expect.any(Date)
        })
      }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'Vacancy', entityId: 1, action: 'PostingTypeTransition', performedById: 2,
          payload: { from, to }
        })
      }));
      expect(res.json).toHaveBeenCalledWith({ id: 1, status: 'Open', postingType: to });
    });

  // jobRef and existing Application rows are deliberately untouched by a
  // transition - a candidate who already applied under the old posting
  // type remains a valid applicant in the same pool.
  test('does not touch jobRef or reach into Application rows', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal', jobRef: 'UCAA/ADV/INT/01/2026' });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open', postingType: 'External' });
    const res = mockRes();

    await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: 'External' }, user: { id: 2, role: 'Manager' } }, res);

    const data = prisma.vacancy.update.mock.calls[0][0].data;
    expect(data.jobRef).toBeUndefined();
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  test('refuses to transition a vacancy whose posting type is already locked, regardless of deadline', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal', postingTypeLocked: true, deadline: new Date('2999-01-01') });
    const res = mockRes();
    await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: 'External' }, user: { id: 2, role: 'Manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('a pre-deadline transition does not lock the vacancy', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal', postingTypeLocked: false, deadline: new Date('2999-01-01') });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open', postingType: 'External' });
    const res = mockRes();
    await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: 'External' }, user: { id: 2, role: 'Manager' } }, res);
    expect(prisma.vacancy.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ postingTypeLocked: false })
    }));
  });

  test('a post-deadline transition locks the vacancy against any further transition', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal', postingTypeLocked: false, deadline: new Date('2000-01-01') });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open', postingType: 'External' });
    const res = mockRes();
    await vacancyController.transitionPostingType({ params: { id: '1' }, body: { postingType: 'External' }, user: { id: 2, role: 'Manager' } }, res);
    expect(prisma.vacancy.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ postingTypeLocked: true })
    }));
  });

  test('leaving the deadline unchanged (kept as-is) on an already-passed deadline is accepted without re-validating it', async () => {
    const pastDeadline = new Date('2000-01-01');
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal', postingTypeLocked: false, deadline: pastDeadline });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open', postingType: 'External' });
    const res = mockRes();
    await vacancyController.transitionPostingType({
      params: { id: '1' }, body: { postingType: 'External', deadline: pastDeadline.toISOString() }, user: { id: 2, role: 'Manager' }
    }, res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(prisma.vacancy.update).toHaveBeenCalled();
  });

  test('rejects extending the deadline to a genuinely new past date', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal', postingTypeLocked: false, deadline: new Date('2000-01-01') });
    const res = mockRes();
    await vacancyController.transitionPostingType({
      params: { id: '1' }, body: { postingType: 'External', deadline: '2000-06-15' }, user: { id: 2, role: 'Manager' }
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  test('extends the deadline to a valid future date as part of the transition', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Open', postingType: 'Internal', postingTypeLocked: false, deadline: new Date('2000-01-01') });
    prisma.vacancy.update.mockResolvedValue({ id: 1, status: 'Open', postingType: 'External' });
    const res = mockRes();
    await vacancyController.transitionPostingType({
      params: { id: '1' }, body: { postingType: 'External', deadline: '2999-01-01' }, user: { id: 2, role: 'Manager' }
    }, res);
    expect(prisma.vacancy.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deadline: new Date('2999-01-01'), postingTypeLocked: true })
    }));
  });
});

describe('readvertise', () => {
  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await vacancyController.readvertise({ params: { id: '99' }, body: {}, user: { id: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test.each(['PendingApproval', 'Open', 'PartiallyFilled', 'Filled'])(
    'refuses to readvertise a %s vacancy - only a closed one can be readvertised', async (status) => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status, positionId: 100, reportsToPositionId: null });
      const res = mockRes();
      await vacancyController.readvertise({ params: { id: '1' }, body: { postingType: 'External' }, user: { id: 1 } }, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(prisma.vacancy.create).not.toHaveBeenCalled();
    });

  test('rejects with no postingType', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Closed', positionId: 100, reportsToPositionId: null });
    const res = mockRes();
    await vacancyController.readvertise({ params: { id: '1' }, body: {}, user: { id: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid field (e.g. a past deadline) same as create()', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Closed', positionId: 100, reportsToPositionId: null });
    const res = mockRes();
    await vacancyController.readvertise({
      params: { id: '1' }, body: { postingType: 'External', deadline: '2000-01-01' }, user: { id: 1 }
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('returns 400 if the underlying position no longer exists', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, status: 'Closed', positionId: 100, reportsToPositionId: null });
    prisma.position.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await vacancyController.readvertise({ params: { id: '1' }, body: { postingType: 'External' }, user: { id: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.create).not.toHaveBeenCalled();
  });

  test('creates a new PendingApproval vacancy linked back to the closed original, with a fresh jobRef', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 42, status: 'Closed', positionId: 100, reportsToPositionId: 101, title: 'Stale Title' });
    prisma.position.findUnique.mockResolvedValue(officerCorp);
    prisma.vacancy.create.mockResolvedValue({ id: 43 });
    const res = mockRes();

    await vacancyController.readvertise({ params: { id: '42' }, body: { postingType: 'External', positionsRequired: 2 }, user: { id: 1 } }, res);

    expect(prisma.vacancy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        readvertisedFromId: 42, status: 'PendingApproval', title: 'CWG Officer',
        positionId: 100, reportsToPositionId: 101, positionsRequired: 2, postingType: 'External',
        jobRef: expect.stringMatching(/^UCAA\/ADV\/EXT\/\d{2}\/\d{4}$/), createdById: 1
      })
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('listPublic', () => {
  // Strict bidirectional visibility - PostingType.Open no longer exists,
  // so a verified Internal candidate sees ONLY Internal postings, never
  // External ones too.
  test('shows only Internal postings to a verified Internal candidate token', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    const req = { user: { type: 'candidate', candidateType: 'Internal' } };
    await vacancyController.listPublic(req, mockRes());

    expect(prisma.vacancy.findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['Open', 'PartiallyFilled'] },
      postingType: 'Internal'
    });
  });

  test('shows only External postings to a verified External candidate token', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    const req = { user: { type: 'candidate', candidateType: 'External' } };
    await vacancyController.listPublic(req, mockRes());

    expect(prisma.vacancy.findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['Open', 'PartiallyFilled'] },
      postingType: 'External'
    });
  });

  test('defaults to the safe External filter for an anonymous request (no token)', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    await vacancyController.listPublic({ user: undefined }, mockRes());

    expect(prisma.vacancy.findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['Open', 'PartiallyFilled'] },
      postingType: 'External'
    });
  });
});

describe('getOne', () => {
  const fullVacancy = { id: 5, title: 'Officer', internalSalaryRange: '10-12M', recruiterNotes: 'prefers internal' };

  test('returns 404 for a vacancy id that does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const res = mockRes();

    await vacancyController.getOne({ params: { id: '999' }, user: undefined }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('strips internalSalaryRange/recruiterNotes for an anonymous request', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ ...fullVacancy });
    const res = mockRes();

    await vacancyController.getOne({ params: { id: '5' }, user: undefined }, res);

    const returned = res.json.mock.calls[0][0];
    expect(returned.internalSalaryRange).toBeUndefined();
    expect(returned.recruiterNotes).toBeUndefined();
    expect(returned.title).toBe('Officer');
  });

  test('strips internalSalaryRange/recruiterNotes for a candidate request', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ ...fullVacancy });
    const res = mockRes();

    await vacancyController.getOne({ params: { id: '5' }, user: { type: 'candidate' } }, res);

    const returned = res.json.mock.calls[0][0];
    expect(returned.internalSalaryRange).toBeUndefined();
    expect(returned.recruiterNotes).toBeUndefined();
  });

  test('includes internalSalaryRange/recruiterNotes for an authenticated staff request', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ ...fullVacancy });
    const res = mockRes();

    await vacancyController.getOne({ params: { id: '5' }, user: { type: 'staff' } }, res);

    const returned = res.json.mock.calls[0][0];
    expect(returned.internalSalaryRange).toBe('10-12M');
    expect(returned.recruiterNotes).toBe('prefers internal');
  });
});

describe('listForAdmin', () => {
  // Every staff role that can reach this route is the same DHRA HR team -
  // not department-specific business partners siloed to their own
  // department's hiring - so nobody is scoped, regardless of role or
  // whether departmentId happens to be set.
  test.each(['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director'])(
    '%s sees every vacancy, regardless of department', async (role) => {
      prisma.vacancy.findMany.mockResolvedValue([]);
      const req = { user: { role, departmentId: 10 } };
      await vacancyController.listForAdmin(req, mockRes());
      expect(prisma.vacancy.findMany.mock.calls[0][0].where).toEqual({});
    });

  test('sees everything even with no departmentId assigned at all', async () => {
    prisma.vacancy.findMany.mockResolvedValue([]);
    const req = { user: { role: 'HR_Officer', departmentId: null } };
    await vacancyController.listForAdmin(req, mockRes());
    expect(prisma.vacancy.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe('listApplications', () => {
  test('rejects a non-numeric vacancy id', async () => {
    const req = { params: { id: 'abc' } };
    const res = mockRes();
    await vacancyController.listApplications(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('saveRanking', () => {
  const workflow = require('../src/services/workflowService');

  test('rejects a non-array applicationIds', async () => {
    const req = { params: { id: '1' }, body: { applicationIds: 'not-an-array' } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.findUnique).not.toHaveBeenCalled();
  });

  test('rejects an empty applicationIds array', async () => {
    const req = { params: { id: '1' }, body: { applicationIds: [] } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects an applicationIds array containing a non-integer', async () => {
    const req = { params: { id: '1' }, body: { applicationIds: [1, 'two', 3] } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a duplicate application id', async () => {
    const req = { params: { id: '1' }, body: { applicationIds: [1, 2, 1], applicationRankVersions: { 1: 0, 2: 0 } } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('duplicate') }));
  });

  test('rejects when applicationRankVersions is missing an entry for one of the ids', async () => {
    const req = { params: { id: '1' }, body: { applicationIds: [1, 2], applicationRankVersions: { 1: 0 } } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.vacancy.findUnique).not.toHaveBeenCalled();
  });

  test('returns 404 when the vacancy does not exist', async () => {
    prisma.vacancy.findUnique.mockResolvedValue(null);
    const req = { params: { id: '1' }, body: { applicationIds: [1, 2], applicationRankVersions: { 1: 0, 2: 0 } } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // A crafted/stale request could otherwise rank an application that
  // belongs to a completely different vacancy - assertCanShortlist only
  // checks internal-verification status, not vacancy ownership.
  test('rejects an application id that does not belong to this vacancy', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2 });
    prisma.application.findMany.mockResolvedValue([{ id: 1, rankVersion: 0 }]); // only 1 of the 2 requested ids actually belongs
    const req = { params: { id: '1' }, body: { applicationIds: [1, 2], applicationRankVersions: { 1: 0, 2: 0 } } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('do not belong') }));
  });

  // Optimistic-concurrency guard - if the version the client last saw
  // doesn't match what's in the DB now, someone else's write landed in
  // between and this whole batch must be rejected, not silently applied
  // over it.
  test('returns 409 when an application\'s rankVersion has moved on since the client loaded it', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2 });
    prisma.application.findMany.mockResolvedValue([{ id: 1, rankVersion: 3 }]); // DB now at 3, client thinks 0
    const req = { params: { id: '1' }, body: { applicationIds: [1], applicationRankVersions: { 1: 0 } } };
    const res = mockRes();
    await vacancyController.saveRanking(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // saveRanking only ever proposes a shortlist (ShortlistProposed, stamped
  // with who ranked it) - approveShortlist is what makes it effective. See
  // applicationController.approveShortlist / workflowService.assertNotSelfApprovedShortlist.
  test('ranks every application transactionally as ShortlistProposed, computing Primary/Reserve from positionsRequired, and bumps rankVersion', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 1 });
    prisma.application.findMany.mockResolvedValue([{ id: 1, rankVersion: 0 }, { id: 2, rankVersion: 2 }]);
    jest.spyOn(workflow, 'assertCanShortlist').mockResolvedValue(undefined);
    prisma.application.update.mockResolvedValue({});
    const req = { params: { id: '1' }, body: { applicationIds: [1, 2], applicationRankVersions: { 1: 0, 2: 2 } }, user: { id: 9 } };
    const res = mockRes();

    await vacancyController.saveRanking(req, res);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        rank: 1, listStatus: 'Primary', status: 'ShortlistProposed', rankVersion: { increment: 1 },
        shortlistProposedAt: expect.any(Date), shortlistProposedById: 9
      }
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: {
        rank: 2, listStatus: 'Reserve', status: 'ShortlistProposed', rankVersion: { increment: 1 },
        shortlistProposedAt: expect.any(Date), shortlistProposedById: 9
      }
    });
    expect(res.json).toHaveBeenCalled();
  });

  test('surfaces assertCanShortlist\'s error message per application without writing anything', async () => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 1, positionsRequired: 2 });
    prisma.application.findMany.mockResolvedValue([{ id: 1, rankVersion: 0 }]);
    jest.spyOn(workflow, 'assertCanShortlist').mockRejectedValue(new Error('Internal candidate employment must be HR Verified before shortlisting'));
    const req = { params: { id: '1' }, body: { applicationIds: [1], applicationRankVersions: { 1: 0 } } };
    const res = mockRes();

    await vacancyController.saveRanking(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(prisma.application.update).not.toHaveBeenCalled();
  });
});
