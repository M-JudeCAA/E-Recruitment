import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/models/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../src/models/useInbox', () => ({ useInbox: () => null }));
vi.mock('../../src/models/staffApiClient', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
// eslint-disable-next-line import/first
import { useAuth } from '../../src/models/AuthContext';
// eslint-disable-next-line import/first
import staffClient from '../../src/models/staffApiClient';
// eslint-disable-next-line import/first
import HRSidebar from '../../src/components/HRSidebar';
// eslint-disable-next-line import/first
import HrTeam from '../../src/views/HrTeam';

const TEAM = {
  assignableRoles: ['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer'],
  accounts: [
    { id: 2, name: 'Alice Officer', email: 'hro@caa.co.ug', role: 'HR_Officer', active: true, lockedReason: null },
    { id: 1, name: 'Mary Manager', email: 'manager@caa.co.ug', role: 'Manager', active: true, lockedReason: 'This is your own account.' }
  ]
};

describe('HR team in the sidebar', () => {
  const renderSidebar = () => render(<MemoryRouter><HRSidebar active="inbox" /></MemoryRouter>);

  test('for a Manager or Director in the HR department', () => {
    useAuth.mockReturnValue({ staff: { role: 'Manager', department: 'HR', name: 'Mary' } });
    renderSidebar();
    expect(screen.getAllByText('HR team').length).toBeGreaterThan(0);
  });

  test('not for a Manager in ICT, nor a Principal HR Officer', () => {
    useAuth.mockReturnValue({ staff: { role: 'Director', department: 'ICT', name: 'Ivy' } });
    const { unmount } = renderSidebar();
    expect(screen.queryByText('HR team')).not.toBeInTheDocument();
    unmount();
    useAuth.mockReturnValue({ staff: { role: 'Principal_HR_Officer', department: 'HR', name: 'Paul' } });
    renderSidebar();
    expect(screen.queryByText('HR team')).not.toBeInTheDocument();
  });
});

describe('the HR team page', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ staff: { role: 'Manager', department: 'HR', name: 'Mary' } });
    staffClient.get.mockResolvedValue({ data: TEAM });
    staffClient.patch.mockResolvedValue({ data: {} });
  });

  test('changes a role below the manager\'s own, with an optional reason', async () => {
    render(<MemoryRouter><HrTeam /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'HR role for Alice Officer' });
    // Only roles below the manager's own are offered.
    expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(TEAM.assignableRoles);

    await userEvent.selectOptions(select, 'Senior_HR_Officer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.type(screen.getByRole('textbox'), 'Promoted after review');
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));

    await waitFor(() => expect(staffClient.patch).toHaveBeenCalledWith('/api/staff-users/hr-team/2/role', { role: 'Senior_HR_Officer', comment: 'Promoted after review' }));
    expect(await screen.findByText(/Alice Officer is now Senior HR Officer/)).toBeInTheDocument();
  });

  test('their own account (and anyone they can\'t change) is shown, not editable', async () => {
    render(<MemoryRouter><HrTeam /></MemoryRouter>);
    await screen.findByText('Mary Manager');
    expect(screen.queryByRole('combobox', { name: 'HR role for Mary Manager' })).not.toBeInTheDocument();
    expect(screen.getByText('This is your own account.')).toBeInTheDocument();
  });
});
