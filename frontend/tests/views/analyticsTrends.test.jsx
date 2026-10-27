import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../src/models/staffApiClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/models/dashboardSocket', () => ({ useDashboardEvents: () => ({ connected: false }) }));
// eslint-disable-next-line import/first
import staffClient from '../../src/models/staffApiClient';
// eslint-disable-next-line import/first
import AnalyticsTrends from '../../src/views/Analytics';

// The dashboard's trends are for every HR tier; approval turnaround by
// approver and delegation activity - about individual staff members - only
// for Managers and Directors.
beforeEach(() => {
  vi.clearAllMocks();
  staffClient.get.mockImplementation(async (url) => ({ data: url.endsWith('/time-to-fill') ? { trend: [] } : [] }));
});
const asked = () => staffClient.get.mock.calls.map(([url]) => url);

test('an HR Officer gets the organisation-level trends, not the staff-level ones', async () => {
  render(<AnalyticsTrends />);
  await waitFor(() => expect(screen.getByText('Panel workload')).toBeInTheDocument());
  expect(asked()).not.toContain('/api/analytics/approval-turnaround');
  expect(asked()).not.toContain('/api/analytics/delegation-activity');
  expect(asked()).toContain('/api/analytics/sla-compliance');
  expect(screen.queryByText('Approval turnaround by approver')).not.toBeInTheDocument();
  expect(screen.queryByText(/delegation activity/i)).not.toBeInTheDocument();
});

test('a Manager also gets approval turnaround by approver and delegation activity', async () => {
  render(<AnalyticsTrends oversight />);
  await waitFor(() => expect(screen.getByText('Approval turnaround by approver')).toBeInTheDocument());
  expect(asked()).toContain('/api/analytics/approval-turnaround');
  expect(asked()).toContain('/api/analytics/delegation-activity');
});
