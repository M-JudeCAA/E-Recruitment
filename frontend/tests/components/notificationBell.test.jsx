import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../src/models/staffApiClient', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
// eslint-disable-next-line import/first
import staffClient from '../../src/models/staffApiClient';
// eslint-disable-next-line import/first
import NotificationBell from '../../src/components/NotificationBell';
// eslint-disable-next-line import/first
import { candidateNotificationLink } from '../../src/utils/candidateNotificationLinks';

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}{location.search}</div>;
}

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/hr']}>
      <NotificationBell />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>
  );
}

const NOTICES = [
  { id: 1, message: 'Ann raised vacancy X for approval.', sentAt: '2026-10-14T07:00:00Z', link: '/hr/inbox?item=vacancy-5-approveVacancy' },
  { id: 2, message: 'Bob applied for Y.', sentAt: '2026-10-14T06:00:00Z', link: '/hr/vacancy/6?tab=applicants' }
];

beforeEach(() => {
  staffClient.get.mockResolvedValue({ data: NOTICES });
  staffClient.patch.mockResolvedValue({ data: {} });
});

describe('NotificationBell', () => {
  test('opening a notification marks it read and goes where it is about', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(screen.getByText('Ann raised vacancy X for approval.'));

    expect(staffClient.patch).toHaveBeenCalledWith('/api/notifications/1/read');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/hr/inbox?item=vacancy-5-approveVacancy'));
  });

  test('"Mark read" only dismisses it, staying on the page', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Mark read' })[1]);

    expect(staffClient.patch).toHaveBeenCalledWith('/api/notifications/2/read');
    expect(screen.queryByText('Bob applied for Y.')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/hr');
  });

  test('"Mark all read" clears the list', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(staffClient.patch).toHaveBeenCalledWith('/api/notifications/read-all');
    expect(await screen.findByText('No unread notifications.')).toBeInTheDocument();
  });
});

describe('candidate notification links', () => {
  test('applications, interviews and offers go to My applications; profile notices to My profile', () => {
    expect(candidateNotificationLink('OfferReceived')).toBe('/dashboard/applications');
    expect(candidateNotificationLink('InterviewScheduled')).toBe('/dashboard/applications');
    expect(candidateNotificationLink('ProfileCompleted')).toBe('/dashboard/profile');
  });
});
