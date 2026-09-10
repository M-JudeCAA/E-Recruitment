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
