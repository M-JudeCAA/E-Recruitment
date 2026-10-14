import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { browserName } from '../../src/utils/userAgent';

vi.mock('../../src/models/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../src/models/useInbox', () => ({ useInbox: () => null }));
// eslint-disable-next-line import/first
import { useAuth } from '../../src/models/AuthContext';
// eslint-disable-next-line import/first
import HRSidebar from '../../src/components/HRSidebar';

describe('browserName', () => {
  test('names the browser and system from a User-Agent string', () => {
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toBe('Edge on Windows');
    expect(browserName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(browserName('curl/8.4.0')).toBe('curl');
    expect(browserName('')).toBe('');
  });
});

describe('the Audit log in the sidebar', () => {
  const renderSidebar = () => render(<MemoryRouter><HRSidebar active="inbox" /></MemoryRouter>);

  test('shows for a system administrator', () => {
    useAuth.mockReturnValue({ staff: { role: null, isSystemAdmin: true, name: 'Sam' } });
    renderSidebar();
    expect(screen.getAllByText('Audit log').length).toBeGreaterThan(0);
  });

  test('not for anyone else, a Director included', () => {
    useAuth.mockReturnValue({ staff: { role: 'Director', isSystemAdmin: false, name: 'Dee' } });
    renderSidebar();
    expect(screen.queryByText('Audit log')).not.toBeInTheDocument();
  });
});
