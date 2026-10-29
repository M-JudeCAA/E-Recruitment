import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/models/staffApiClient', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
// eslint-disable-next-line import/first
import staffClient from '../../src/models/staffApiClient';
// eslint-disable-next-line import/first
import SignedCopy from '../../src/components/workspace/SignedCopy';

// The signed requisition copy on the vacancy's Requisition panel: replaced
// by anyone in HR before approval, by a Senior HR Officer+ with a reason
// after, with the history shown.
const PENDING = { id: 5, status: 'PendingApproval', approvedAt: null, requisitionSignedCopyUrl: '/api/files/requisition-signed-a.pdf', requisitionSignedCopyName: 'signed.pdf' };
const APPROVED = { ...PENDING, status: 'Open', approvedAt: '2026-10-29T10:35:00Z' };
const show = (vacancy, role, onChanged = () => {}) => render(<MemoryRouter><SignedCopy vacancy={vacancy} staffRole={role} onChanged={onChanged} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  staffClient.get.mockResolvedValue({ data: [] });
});

test('before approval an HR Officer may replace it; after approval only a Senior HR Officer or above', async () => {
  const { unmount } = show(PENDING, 'HR_Officer');
  expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
  unmount();

  const second = show(APPROVED, 'HR_Officer');
  expect(screen.queryByRole('button', { name: /replace/i })).toBeNull();
  second.unmount();

  show(APPROVED, 'Senior_HR_Officer');
  expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
});

test('after approval the reason is required before the scan is uploaded', async () => {
  const user = userEvent.setup();
  const onChanged = vi.fn();
  staffClient.put.mockResolvedValue({ data: {} });
  show(APPROVED, 'Senior_HR_Officer', onChanged);

  await user.click(screen.getByRole('button', { name: /replace/i }));
  await user.upload(screen.getByLabelText(/signed requisition/i), new File(['scan'], 'new.pdf', { type: 'application/pdf' }));
  const replace = screen.getAllByRole('button', { name: /^replace$/i }).at(-1);
  expect(replace).toBeDisabled();

  await user.type(screen.getByLabelText(/reason for replacing it/i), 'The first scan was missing page two');
  await user.click(replace);

  await waitFor(() => expect(staffClient.put).toHaveBeenCalledWith('/api/vacancies/5/requisition/signed-copy', expect.any(FormData)));
  const body = staffClient.put.mock.calls[0][1];
  expect(body.get('reason')).toBe('The first scan was missing page two');
  expect(onChanged).toHaveBeenCalled();
});

test('shows who replaced it, when, why and both files', async () => {
  staffClient.get.mockResolvedValue({ data: [{
    id: 1, changedAt: '2026-10-29T12:00:00Z', changedBy: { name: 'Sam Senior' }, changedByRole: 'Senior_HR_Officer', actingFor: null,
    previousUrl: '/api/files/requisition-signed-a.pdf', previousName: 'old.pdf', newUrl: '/api/files/requisition-signed-b.pdf', newName: 'new.pdf',
    afterApproval: true, reason: 'The first scan was missing page two'
  }] });
  show(APPROVED, 'HR_Officer');

  expect(await screen.findByText(/Sam Senior \(Senior HR Officer\)/)).toBeInTheDocument();
  expect(screen.getByText(/after the vacancy was approved/)).toBeInTheDocument();
  expect(screen.getByText('Reason: The first scan was missing page two')).toBeInTheDocument();
  expect(screen.getByText('old.pdf')).toBeInTheDocument();
  expect(screen.getByText('new.pdf')).toBeInTheDocument();
});
