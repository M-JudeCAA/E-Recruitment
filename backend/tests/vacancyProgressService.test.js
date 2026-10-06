jest.mock('../src/config/db', () => require('./__mocks__/db'));
const { computeProgress } = require('../src/services/vacancyProgressService');
const { inAudience } = require('../src/services/inboxService');

const NOW = new Date('2026-10-05T09:00:00Z');
const PAST = new Date('2026-09-01T00:00:00Z');
const FUTURE = new Date('2026-10-30T00:00:00Z');
const vacancy = (over = {}) => ({ id: 1, status: 'Open', deadline: PAST, positionsRequired: 2, createdById: 7, reviewStartedAt: PAST, ...over });
const app = (over = {}) => ({ id: Math.random(), status: 'UnderReview', candidate: { fullName: 'Ann Akello' }, ...over });

beforeEach(() => jest.clearAllMocks());

describe('computeProgress', () => {
  test('a vacancy waiting for approval waits on a Manager or Director, never its creator', () => {
    const p = computeProgress(vacancy({ status: 'PendingApproval', deadline: FUTURE }), {}, NOW);
    expect(p.stage.label).toBe('Pending approval');
    expect(p.stepIndex).toBe(0);
    expect(p.next).toMatchObject({ kind: 'approveVacancy', role: 'Manager', tab: 'overview', excludeStaffIds: [7] });
    expect(p.steps[0].state).toBe('now');
  });

  test('while advertised, nobody on staff has a step unless the committee waits for the DHRA', () => {
    const open = computeProgress(vacancy({ deadline: FUTURE }), { applications: [app({ status: 'Submitted' })] }, NOW);
    expect(open.stage.label).toBe('Advertised');
    expect(open.next.role).toBeNull();
    expect(open.steps[1]).toMatchObject({ state: 'now', detail: '1' });

    const waiting = computeProgress(vacancy({ deadline: FUTURE }), { exercise: { status: 'Setup', nominationStatus: 'Submitted', nominationSubmittedById: 3 } }, NOW);
    expect(waiting.next).toMatchObject({ kind: 'approveCommittee', role: 'Director', excludeStaffIds: [3] });
  });

  test('after the deadline with unscreened applications, a Senior HR Officer begins review', () => {
    const p = computeProgress(vacancy({ reviewStartedAt: null }), { applications: [app({ status: 'Submitted' })] }, NOW);
    expect(p.next).toMatchObject({ kind: 'beginReview', role: 'Senior_HR_Officer', tab: 'committee' });
  });

  test('a proposed shortlist waits on a Principal HR Officer who did not propose it', () => {
    const p = computeProgress(vacancy(), { applications: [app({ status: 'ShortlistProposed', shortlistProposedById: 4 })] }, NOW);
    expect(p.stage.label).toBe('Shortlist for approval');
    expect(p.next).toMatchObject({ kind: 'approveShortlist', role: 'Principal_HR_Officer', excludeStaffIds: [4] });
  });

  test('shortlisted candidates without EXCO approval sit at the EXCO step', () => {
    const p = computeProgress(vacancy(), { applications: [app({ status: 'Shortlisted', excoApprovalId: null })] }, NOW);
    expect(p.stepIndex).toBe(3);
    expect(p.next.kind).toBe('attachExco');
  });

  test('interviews held without results put recording them first', () => {
    const p = computeProgress(vacancy(), { applications: [app({ status: 'InterviewScheduled' })], resultsDue: 2 }, NOW);
    expect(p.stage.label).toBe('Interviews');
    expect(p.next).toMatchObject({ kind: 'recordResults', role: 'HR_Officer' });
  });

  test('offers: a recommended offer waits for approval, then a primary with no offer is drafted', () => {
    const recommended = computeProgress(vacancy(), {
      applications: [app({ status: 'Offered', meritStatus: 'Approved', meritListStatus: 'Primary', offer: { status: 'Recommended', recommendedById: 9 } })]
    }, NOW);
    expect(recommended.stage.label).toBe('Offers · 0 of 2 accepted');
    expect(recommended.next).toMatchObject({ kind: 'approveOffer', role: 'Manager', excludeStaffIds: [9] });

    const draft = computeProgress(vacancy(), {
      applications: [
        app({ status: 'Offered', offer: { status: 'Declined' } }),
        app({ status: 'Interviewed', meritStatus: 'Approved', meritListStatus: 'Primary', candidate: { fullName: 'Kenneth Ssali' } })
      ]
    }, NOW);
    expect(draft.next).toMatchObject({ kind: 'draftOffer', role: 'Principal_HR_Officer' });
    expect(draft.next.text).toMatch(/Kenneth Ssali/);
    expect(draft.waitingOn).toBe('Principal HR Officer · draft offer');
  });

  test('a filled vacancy asks for the accepted candidates to be marked hired', () => {
    const p = computeProgress(vacancy({ status: 'Filled', positionsRequired: 1 }), {
      applications: [app({ status: 'Offered', offer: { status: 'Accepted' }, hire: null })]
    }, NOW);
    expect(p.steps.slice(0, 7).every((s) => s.state === 'done')).toBe(true);
    expect(p.steps[7]).toMatchObject({ state: 'now', detail: '0/1' });
    expect(p.next.kind).toBe('markHired');
  });

  test('closed and rejected vacancies have no next step', () => {
    expect(computeProgress(vacancy({ status: 'Closed' }), {}, NOW).next).toBeNull();
    expect(computeProgress(vacancy({ status: 'Rejected' }), {}, NOW).stage.tone).toBe('bad');
  });
});

describe('inbox audience', () => {
  test('a step shows to its tier and the tier above, and Manager steps to Directors too', () => {
    expect(inAudience('Senior_HR_Officer', 2)).toBe(true);
    expect(inAudience('Senior_HR_Officer', 3)).toBe(true);
    expect(inAudience('Senior_HR_Officer', 4)).toBe(false);
    expect(inAudience('Senior_HR_Officer', 1)).toBe(false);
    expect(inAudience('Manager', 5)).toBe(true);
    expect(inAudience('Director', 4)).toBe(false);
    expect(inAudience(null, 5)).toBe(false);
  });
});
