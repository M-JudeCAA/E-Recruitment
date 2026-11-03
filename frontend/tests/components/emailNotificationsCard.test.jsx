import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/models/apiClient', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
// eslint-disable-next-line import/first
import client from '../../src/models/apiClient';
// eslint-disable-next-line import/first
import EmailNotificationsCard from '../../src/components/EmailNotificationsCard';

describe('EmailNotificationsCard', () => {
  test('from the emailed link: stops the emails without signing in', async () => {
    client.get.mockResolvedValue({ data: { emailNotifications: true, email: 'g***@caa.co.ug' } });
    client.put.mockResolvedValue({ data: { emailNotifications: false, email: 'g***@caa.co.ug' } });
    render(<EmailNotificationsCard token="12-abc" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Stop these emails' }));

    expect(client.get).toHaveBeenCalledWith('/api/candidates/email-preferences/12-abc');
    expect(client.put).toHaveBeenCalledWith('/api/candidates/email-preferences/12-abc', { emailNotifications: false });
    expect(await screen.findByText(/you will no longer get these emails/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me again' })).toBeInTheDocument();
  });

  test('on My profile: works on their own account, and says what they may miss', async () => {
    client.get.mockResolvedValue({ data: { emailNotifications: false, email: 'g***@caa.co.ug' } });
    render(<EmailNotificationsCard />);
    expect(await screen.findByText(/may miss an interview invitation/)).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith('/api/candidates/me/email-preferences');
  });

  test('a link that is not valid says so', async () => {
    client.get.mockRejectedValue({ response: { data: { error: 'This link is not valid.' } } });
    render(<EmailNotificationsCard token="bad" />);
    expect(await screen.findByText('This link is not valid.')).toBeInTheDocument();
  });
});
