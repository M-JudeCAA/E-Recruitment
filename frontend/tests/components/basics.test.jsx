import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from '../../src/components/Button';
import Modal from '../../src/components/Modal';
import ReasonDialog from '../../src/components/ReasonDialog';
import StatusBadge, { STATUS_COLORS, statusLabel } from '../../src/components/StatusBadge';

describe('Button', () => {
  test('runs its action when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('while loading it can\'t be clicked again, and says what it is doing', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} loading loadingText="Saving...">Save</Button>);
    const button = screen.getByRole('button', { name: /Saving\.\.\./ });
    expect(button).toBeDisabled();
    expect(button).not.toHaveTextContent('Save');
    // The spinner tells a screen reader it is working.
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('keeps its label while loading when no other text is given', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  test('carries the variant class the theme styles', () => {
    render(<Button variant="danger" className="wide">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn-danger', 'wide');
  });
});

describe('Modal', () => {
  test('is a dialog named by its title, with its content and footer', () => {
    render(<Modal title="Close vacancy" onClose={() => {}} footer={<button>Confirm</button>}>Are you sure?</Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Close vacancy' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Are you sure?');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  test('closes from the X and from the backdrop, but not from a click inside it', async () => {
    const onClose = vi.fn();
    const { container } = render(<Modal title="Details" onClose={onClose}><p>Body</p></Modal>);
    await userEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

// A decision that needs a comment: returning, rejecting or closing a vacancy.
describe('ReasonDialog', () => {
  const open = (props = {}) => {
    const onSubmit = props.onSubmit || vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    render(<ReasonDialog title="Close vacancy" label="Reason for closing" confirmLabel="Close vacancy" busyLabel="Closing..."
      onClose={onClose} {...props} onSubmit={onSubmit} />);
    return { onSubmit, onClose, field: screen.getByRole('textbox'), confirm: screen.getByRole('button', { name: 'Close vacancy' }) };
  };

  test('won\'t send without a reason', async () => {
    const { onSubmit, confirm, field } = open();
    await userEvent.click(confirm);
    expect(screen.getByRole('alert')).toHaveTextContent('Please give a reason.');
    await userEvent.type(field, '  a ');
    await userEvent.click(confirm);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('sends the reason, trimmed', async () => {
    const { onSubmit, confirm, field } = open();
    await userEvent.type(field, '  Position frozen  ');
    await userEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith('Position frozen');
  });

  test('shows the API\'s refusal and stays open to try again', async () => {
    const refusal = Object.assign(new Error('Request failed'), { response: { data: { error: 'This vacancy was already updated' } } });
    const { onClose, confirm, field } = open({ onSubmit: vi.fn().mockRejectedValue(refusal) });
    await userEvent.type(field, 'Position frozen');
    await userEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('This vacancy was already updated');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close vacancy' })).toBeEnabled();
  });

  test('can\'t be sent twice or cancelled while it is being saved', async () => {
    let finish;
    const onSubmit = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { field, confirm } = open({ onSubmit });
    await userEvent.type(field, 'Position frozen');
    await userEvent.click(confirm);
    const busy = screen.getByRole('button', { name: 'Closing...' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.click(busy);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish();
  });

  test('Cancel closes it', async () => {
    const { onClose, onSubmit } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('status wording and colours', () => {
  test.each([
    ['PendingApproval', 'Pending approval'], ['PartiallyFilled', 'Partially filled'], ['UnderReview', 'Under review'],
    ['InterviewScheduled', 'Interview scheduled'], ['ShortlistProposed', 'Shortlist proposed'], ['NoShow', 'No-show'],
    ['HR_Verified', 'HR verified'], ['Discrepancy_Flagged', 'Discrepancy flagged'], ['NotQualified', 'Not qualified'],
    ['RescheduleRequested', 'New time requested'], ['Open', 'Open']
  ])('%s reads "%s"', (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });

  test('nothing for no status', () => {
    expect(statusLabel(null)).toBe('');
    expect(statusLabel(undefined)).toBe('');
  });

  test('a badge shows the words in the status\'s colour', () => {
    render(<StatusBadge status="Rejected" />);
    const badge = screen.getByText('Rejected');
    expect(badge).toHaveClass('status-badge');
    expect(badge.style.getPropertyValue('--badge-color')).toBe(STATUS_COLORS.Rejected);
  });

  test('a label can replace the words without changing the colour', () => {
    render(<StatusBadge status="Completed" label="Held" />);
    expect(screen.getByText('Held').style.getPropertyValue('--badge-color')).toBe(STATUS_COLORS.Completed);
  });

  test('an unknown status is still shown, in the neutral colour', () => {
    render(<StatusBadge status="SomethingNew" />);
    expect(screen.getByText('Something new').style.getPropertyValue('--badge-color')).toBe('var(--color-text-muted)');
  });

  // Every status the API can send has a colour here, not per view.
  test.each([
    'Draft', 'Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn',
    'PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed', 'Returned',
    'Recommended', 'Approved', 'Accepted', 'Declined', 'Expired',
    'Scheduled', 'Completed', 'Cancelled', 'NoShow', 'Pending', 'HR_Verified', 'Discrepancy_Flagged'
  ])('%s has a colour', (status) => {
    expect(STATUS_COLORS[status]).toMatch(/^var\(--color-/);
  });
});
