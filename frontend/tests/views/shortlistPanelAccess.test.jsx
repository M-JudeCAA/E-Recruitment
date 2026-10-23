import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/models/apiClient', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
// eslint-disable-next-line import/first
import client from '../../src/models/apiClient';
// eslint-disable-next-line import/first
import { ConfirmProvider } from '../../src/components/ConfirmDialog';
// eslint-disable-next-line import/first
import ShortlistPanelAccess from '../../src/views/ShortlistPanelAccess';
// eslint-disable-next-line import/first
import { renderAt } from '../helpers';

// A committee member with 30 applicants: every third one still to rate, one
// stood down from, the first two in the calibration set.
const name = (n) => `Applicant ${String(n).padStart(2, '0')}`;
const APPLICANTS = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  return {
    applicationId: 100 + n, candidateName: name(n), calibration: n <= 2,
    conflict: n === 30, rated: n % 3 === 0 ? 0 : 1, complete: n === 30 || n % 3 !== 0
  };
});
const CTX = {
  name: 'Grace', isChair: false, stage: 'Rating', submittedAt: null, ratingDeadline: null,
  vacancy: { jobRef: 'UCAA/ADV/EXT/001/2026', title: 'ICT Officer' },
  criteria: [{ id: 'e1', kind: 'Essential', label: 'Degree' }], applicants: APPLICANTS
};

function detail(applicationId) {
  const a = APPLICANTS.find((x) => x.applicationId === applicationId);
  return {
    applicationId, candidate: { fullName: a.candidateName, candidateType: 'External' }, documents: [],
    criteria: CTX.criteria, ratings: {}, editable: true, conflict: null
  };
}

beforeEach(() => {
  client.get.mockImplementation((url) => {
    const match = url.match(/applicants\/(\d+)$/);
    return Promise.resolve({ data: match ? detail(Number(match[1])) : CTX });
  });
});

const renderPage = () => renderAt('/shortlist-panel/tok', <ConfirmProvider><ShortlistPanelAccess /></ConfirmProvider>, { route: '/shortlist-panel/:token' });
const rows = () => screen.getAllByRole('button').filter((b) => /^Applicant \d\d/.test(b.textContent));

describe('the committee member\'s list of applicants', () => {
  test('is paged', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(name(1));
    expect(rows()).toHaveLength(25);
    expect(screen.getByText(/Showing 1-25 of 30 applicants/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(rows()).toHaveLength(5);
    expect(screen.getByText(name(30))).toBeInTheDocument();
  });

  test('filters by where each applicant stands, and searches by name', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(name(1));

    await user.click(screen.getByRole('button', { name: /To rate/ }));
    expect(rows().map((r) => r.textContent.slice(0, 12))).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27].map(name));

    await user.click(screen.getByRole('button', { name: /Stood down/ }));
    expect(rows()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Calibration/ }));
    expect(rows().map((r) => r.textContent.slice(0, 12))).toEqual([name(1), name(2)]);

    await user.click(screen.getByRole('button', { name: /^All/ }));
    await user.type(screen.getByLabelText('Search applicants by name'), '1');
    expect(rows()).toHaveLength(12); // 01, 10-19, 21
    await user.type(screen.getByLabelText('Search applicants by name'), 'x');
    expect(screen.getByText('No applicants match.')).toBeInTheDocument();
  });

  test('prev and next walk the list as it was filtered', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(name(1));
    await user.click(screen.getByRole('button', { name: /To rate/ }));
    await user.click(screen.getByText(name(6)));

    expect(await screen.findByText('Applicant 2 of 9 (filtered from 30)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next applicant' }));
    await waitFor(() => expect(screen.getByText('Applicant 3 of 9 (filtered from 30)')).toBeInTheDocument());
    expect(within(screen.getByRole('heading', { level: 3, name: name(9) })).getByText(name(9))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /All applicants/ }));
    expect(rows()).toHaveLength(9); // the filter is kept
  });
});
