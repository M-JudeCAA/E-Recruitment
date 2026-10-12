import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { AuthProvider, useAuth, useSessionEndedMessage } from '../../src/models/AuthContext';
import { SESSION_ENDED_EVENT } from '../../src/models/apiClient';
import { clearMicrosoftSession } from '../../src/models/entraAuth';
import { clearInbox } from '../../src/models/useInbox';

// Microsoft sign-in and the Inbox count have their own modules; here they
// only need to be told when a session ends.
vi.mock('../../src/models/entraAuth', () => ({ clearMicrosoftSession: vi.fn() }));
vi.mock('../../src/models/useInbox', () => ({ clearInbox: vi.fn() }));

const session = () => renderHook(() => useAuth(), { wrapper: AuthProvider });
const sessionEnds = (detail) => act(() => { window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail })); });

describe('signing in and out', () => {
  test('nobody is signed in to begin with', () => {
    const { result } = session();
    expect(result.current.staff).toBeNull();
    expect(result.current.candidate).toBeNull();
  });

  test('a staff sign-in is kept for the next visit', () => {
    const { result } = session();
    act(() => result.current.loginStaff('staff-jwt', 'Manager', 'Mary Manager', 'manager@caa.co.ug'));
    expect(result.current.staff).toEqual({ role: 'Manager', name: 'Mary Manager', email: 'manager@caa.co.ug', isSystemAdmin: false });
    expect(localStorage.getItem('staffToken')).toBe('staff-jwt');

    // A new page load reads the same session back.
    expect(session().result.current.staff).toEqual({ role: 'Manager', name: 'Mary Manager', email: 'manager@caa.co.ug', isSystemAdmin: false });
  });

  test('an accounts-only system administrator has no HR role', () => {
    const { result } = session();
    act(() => result.current.loginStaff('admin-jwt', null, 'Sam Admin', 'admin@caa.co.ug', true));
    expect(result.current.staff).toEqual({ role: null, name: 'Sam Admin', email: 'admin@caa.co.ug', isSystemAdmin: true });
    expect(localStorage.getItem('staffRole')).toBeNull();
    expect(session().result.current.staff).toEqual(expect.objectContaining({ role: null, isSystemAdmin: true }));
  });

  test('signing in as someone with no role doesn\'t inherit the last person\'s', () => {
    const { result } = session();
    act(() => result.current.loginStaff('a', 'Director', 'Dora', 'dhra@caa.co.ug'));
    act(() => result.current.loginStaff('b', null, 'Sam Admin', null, true));
    expect(localStorage.getItem('staffRole')).toBeNull();
    expect(localStorage.getItem('staffEmail')).toBeNull();
  });

  test('staff sign-out forgets everything, the Microsoft session and the Inbox included', () => {
    const { result } = session();
    act(() => result.current.loginStaff('staff-jwt', 'Manager', 'Mary Manager', 'manager@caa.co.ug', true));
    act(() => result.current.logoutStaff());
    expect(result.current.staff).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('staff'))).toEqual([]);
    expect(clearMicrosoftSession).toHaveBeenCalledWith('staff');
    expect(clearInbox).toHaveBeenCalled();
  });

  test('a candidate signs in, changes their photo and signs out', () => {
    const { result } = session();
    act(() => result.current.loginCandidate('candidate-jwt', 'External', 'Jane Doe', null, 'jane@example.com'));
    expect(result.current.candidate).toEqual({ candidateType: 'External', fullName: 'Jane Doe', photoUrl: null, email: 'jane@example.com' });

    act(() => result.current.updateCandidatePhoto('/api/files/photo-1.png'));
    expect(result.current.candidate.photoUrl).toBe('/api/files/photo-1.png');
    expect(session().result.current.candidate.photoUrl).toBe('/api/files/photo-1.png');

    act(() => result.current.logoutCandidate());
    expect(result.current.candidate).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('candidate'))).toEqual([]);
    expect(clearMicrosoftSession).toHaveBeenCalledWith('candidate');
  });

  test('a staff member and a candidate can be signed in side by side', () => {
    const { result } = session();
    act(() => result.current.loginStaff('staff-jwt', 'HR_Officer', 'Henry', 'hro@caa.co.ug'));
    act(() => result.current.loginCandidate('candidate-jwt', 'Internal', 'Henry', null, 'hro@caa.co.ug'));
    act(() => result.current.logoutCandidate());
    expect(result.current.staff).not.toBeNull();
    expect(localStorage.getItem('staffToken')).toBe('staff-jwt');
  });
});

// The API refused the session (apiClient fires the event): it ends in the
// browser too, and the sign-in page says why.
describe('a session ended by the API', () => {
  const reason = () => sessionStorage.getItem('sessionEndedMessage');

  test('a deactivated staff account is signed out and told so', () => {
    const { result } = session();
    act(() => result.current.loginStaff('staff-jwt', 'Manager', 'Mary', 'manager@caa.co.ug'));
    sessionEnds({ kind: 'staff', message: 'Your staff account is no longer active' });
    expect(result.current.staff).toBeNull();
    expect(localStorage.getItem('staffToken')).toBeNull();
    expect(reason()).toMatch(/deactivated/);
  });

  test('an expired session says it expired', () => {
    const { result } = session();
    act(() => result.current.loginStaff('staff-jwt', 'Manager', 'Mary', 'manager@caa.co.ug'));
    sessionEnds({ kind: 'staff', message: 'Invalid or expired token' });
    expect(reason()).toMatch(/expired/);
  });

  test('a candidate whose data was erased is told the account is closed', () => {
    const { result } = session();
    act(() => result.current.loginCandidate('candidate-jwt', 'External', 'Jane', null, 'jane@example.com'));
    sessionEnds({ kind: 'candidate', message: 'This account has been closed' });
    expect(result.current.candidate).toBeNull();
    expect(reason()).toMatch(/closed/);
  });

  test('only the session that ended is signed out', () => {
    const { result } = session();
    act(() => result.current.loginStaff('staff-jwt', 'HR_Officer', 'Henry', 'hro@caa.co.ug'));
    act(() => result.current.loginCandidate('candidate-jwt', 'Internal', 'Henry', null, 'hro@caa.co.ug'));
    sessionEnds({ kind: 'candidate', message: 'Invalid or expired token' });
    expect(result.current.candidate).toBeNull();
    expect(result.current.staff).not.toBeNull();
  });

  test('nothing happens when nobody of that kind is signed in', () => {
    const { result } = session();
    sessionEnds({ kind: 'staff', message: 'Invalid or expired token' });
    expect(result.current.staff).toBeNull();
    expect(reason()).toBeNull();
  });

  test('the sign-in page shows the reason once', () => {
    sessionStorage.setItem('sessionEndedMessage', 'Your session has expired. Please sign in again.');
    function SignIn() {
      return <p role="status">{useSessionEndedMessage()}</p>;
    }
    const first = render(<SignIn />);
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired. Please sign in again.');
    first.unmount();
    render(<SignIn />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
