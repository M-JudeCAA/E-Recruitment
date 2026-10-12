import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  GuestPortGate, InternalPortGate, RequireCandidate, RequireInternalCandidate, RequireStaff, RequireStaffPort,
  RequireSystemAdmin, RequireSystemAdminOrRole, staffHome
} from '../../src/components/ProtectedRoute';
import { useAuth } from '../../src/models/AuthContext';
import { isStaffPort } from '../../src/staffPort';
import { isInternalPort } from '../../src/internalPort';
import { LocationProbe, renderAt } from '../helpers';

vi.mock('../../src/models/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../src/staffPort', () => ({ isStaffPort: vi.fn() }));
vi.mock('../../src/internalPort', () => ({ isInternalPort: vi.fn() }));

// Client-side gating only - the API's middleware is the real enforcement -
// but it decides what each kind of visitor is shown and where they are sent.
const signedIn = ({ staff = null, candidate = null } = {}) => useAuth.mockReturnValue({ staff, candidate });
const site = (which) => {
  isStaffPort.mockReturnValue(which === 'staff');
  isInternalPort.mockReturnValue(which === 'internal');
};
const landedOn = () => screen.getByTestId('location').textContent;
const PAGE = <p>The page</p>;

beforeEach(() => {
  signedIn();
  site('public');
});

describe('where a staff member belongs', () => {
  test('every HR role lands on the Inbox', () => {
    for (const role of ['HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director']) {
      expect(staffHome({ role })).toBe('/hr/inbox');
    }
  });

  test('an accounts-only system administrator lands on Staff accounts', () => {
    expect(staffHome({ role: null, isSystemAdmin: true })).toBe('/hr/staff-accounts');
  });

  test('anyone else is sent to sign in', () => {
    expect(staffHome({ role: null, isSystemAdmin: false })).toBe('/staff/login');
    expect(staffHome(null)).toBe('/staff/login');
  });
});

describe('RequireStaff', () => {
  const at = (minRole) => renderAt('/hr/dashboard', <RequireStaff minRole={minRole}>{PAGE}</RequireStaff>);

  test('sends a visitor who is not signed in to staff sign-in', () => {
    at('HR_Officer');
    expect(landedOn()).toBe('/staff/login');
  });

  test('shows the page to the role it needs, and to every role above it', () => {
    signedIn({ staff: { role: 'Manager' } });
    at('Manager');
    expect(screen.getByText('The page')).toBeInTheDocument();
  });

  test.each([
    ['HR_Officer', 'Senior_HR_Officer'], ['Senior_HR_Officer', 'Principal_HR_Officer'],
    ['Principal_HR_Officer', 'Manager'], ['Manager', 'Director']
  ])('a %s can\'t open a %s page - they go back to their own home', (role, minRole) => {
    signedIn({ staff: { role } });
    at(minRole);
    expect(screen.queryByText('The page')).not.toBeInTheDocument();
    expect(landedOn()).toBe('/hr/inbox');
  });

  test('a Director opens everything', () => {
    signedIn({ staff: { role: 'Director' } });
    at('Manager');
    expect(screen.getByText('The page')).toBeInTheDocument();
  });

  // A system administrator sits outside the HR ladder.
  test('an accounts-only system administrator passes no HR gate', () => {
    signedIn({ staff: { role: null, isSystemAdmin: true } });
    at('HR_Officer');
    expect(landedOn()).toBe('/hr/staff-accounts');
  });

  test('a signed-in candidate is not staff', () => {
    signedIn({ candidate: { candidateType: 'External' } });
    at('HR_Officer');
    expect(landedOn()).toBe('/staff/login');
  });
});

describe('RequireSystemAdmin', () => {
  const at = () => renderAt('/hr/staff-accounts', <RequireSystemAdmin>{PAGE}</RequireSystemAdmin>);

  test('shows staff accounts to a system administrator', () => {
    signedIn({ staff: { role: null, isSystemAdmin: true } });
    at();
    expect(screen.getByText('The page')).toBeInTheDocument();
  });

  test('no HR role manages accounts, however senior', () => {
    signedIn({ staff: { role: 'Director', isSystemAdmin: false } });
    at();
    expect(landedOn()).toBe('/hr/inbox');
  });

  test('sends a visitor who is not signed in to staff sign-in', () => {
    at();
    expect(landedOn()).toBe('/staff/login');
  });
});

describe('RequireSystemAdminOrRole (Settings & data)', () => {
  const at = () => renderAt('/hr/settings', <RequireSystemAdminOrRole minRole="Manager">{PAGE}</RequireSystemAdminOrRole>);

  test.each([
    [{ role: null, isSystemAdmin: true }], [{ role: 'Manager', isSystemAdmin: false }], [{ role: 'Director', isSystemAdmin: false }]
  ])('opens for %o', (staff) => {
    signedIn({ staff });
    at();
    expect(screen.getByText('The page')).toBeInTheDocument();
  });

  test('not for a lower HR role', () => {
    signedIn({ staff: { role: 'Principal_HR_Officer', isSystemAdmin: false } });
    at();
    expect(landedOn()).toBe('/hr/inbox');
  });
});

describe('RequireCandidate', () => {
  test('shows the page to a signed-in candidate', () => {
    signedIn({ candidate: { candidateType: 'External' } });
    renderAt('/dashboard', <RequireCandidate>{PAGE}</RequireCandidate>);
    expect(screen.getByText('The page')).toBeInTheDocument();
  });

  test('sends anyone else to sign in, remembering where they were going', () => {
    renderAt('/apply/17', <RequireCandidate>{PAGE}</RequireCandidate>, { route: '/apply/:vacancyId' });
    expect(landedOn()).toBe('/login?returnTo=%2Fapply%2F17');
  });
});

describe('RequireInternalCandidate (Internal Careers)', () => {
  const at = (path) => renderAt(path, <RequireInternalCandidate>{PAGE}</RequireInternalCandidate>);

  test('shows the page to a UCAA employee signed in with Microsoft', () => {
    signedIn({ candidate: { candidateType: 'Internal' } });
    at('/careers/jobs');
    expect(screen.getByText('The page')).toBeInTheDocument();
  });

  test('an External candidate\'s session doesn\'t count', () => {
    signedIn({ candidate: { candidateType: 'External' } });
    at('/careers/jobs');
    expect(landedOn()).toBe('/careers/sign-in?returnTo=%2Fcareers%2Fjobs');
  });

  test('from the home page there is nothing to go back to', () => {
    at('/careers');
    expect(landedOn()).toBe('/careers/sign-in');
  });
});

// One build serves three sites, told apart by the port.
describe('which site a page belongs to', () => {
  // A layout route, as App.jsx uses the gates.
  const under = (Gate, path) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Gate />}><Route path={path} element={PAGE} /></Route>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );

  describe('staff sign-in', () => {
    const at = () => renderAt('/staff/login', <RequireStaffPort>{PAGE}</RequireStaffPort>);

    test('renders on the staff site', () => {
      site('staff');
      at();
      expect(screen.getByText('The page')).toBeInTheDocument();
    });

    test.each(['public', 'internal'])('is not reachable from the %s site', (which) => {
      site(which);
      at();
      expect(landedOn()).toBe('/');
    });
  });

  describe('the public pages', () => {
    test('render on the public site', () => {
      under(GuestPortGate, '/jobs');
      expect(screen.getByText('The page')).toBeInTheDocument();
    });

    test('on the staff site every one of them goes to staff sign-in', () => {
      site('staff');
      under(GuestPortGate, '/register');
      expect(landedOn()).toBe('/staff/login');
    });

    test('on Internal Careers every one of them goes to its home', () => {
      site('internal');
      under(GuestPortGate, '/jobs');
      expect(landedOn()).toBe('/careers');
    });
  });

  describe('the Internal Careers pages', () => {
    test('render on Internal Careers', () => {
      site('internal');
      under(InternalPortGate, '/careers');
      expect(screen.getByText('The page')).toBeInTheDocument();
    });

    test.each(['public', 'staff'])('go to the home page on the %s site', (which) => {
      site(which);
      under(InternalPortGate, '/careers');
      expect(landedOn()).toBe('/');
    });
  });
});
