import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../src/models/apiClient', () => ({ default: { get: vi.fn(() => new Promise(() => {})), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
// eslint-disable-next-line import/first
import Register from '../../src/views/Register';
// eslint-disable-next-line import/first
import RefereesStep from '../../src/views/apply-wizard/RefereesStep';

// The pages that check phone numbers as they are typed actually render and
// say so (a missing import here once crashed the registration page, which
// the build doesn't catch).

test('registration: a phone number with letters is refused as the field is left', () => {
  render(<MemoryRouter><Register /></MemoryRouter>);
  const phone = screen.getByLabelText(/^Phone/);
  fireEvent.change(phone, { target: { value: '07ab123456' } });
  fireEvent.blur(phone);
  expect(screen.getByText(/Enter a valid phone number/)).toBeInTheDocument();
});

test('referees: a bad phone, a bad email and the candidate\'s own email are each marked', () => {
  const referees = [
    { name: 'A', phone: '07ab123456', email: 'a@example.com' },
    { name: 'B', phone: '0772123456', email: 'not-an-email' },
    { name: 'C', phone: '0772123456', email: 'me@example.com' }
  ];
  render(<RefereesStep referees={referees} setReferee={() => () => {}} ownEmail="me@example.com" />);
  expect(screen.getByText(/Enter a valid phone number/)).toBeInTheDocument();
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(screen.getByText(/not your own/)).toBeInTheDocument();
});
