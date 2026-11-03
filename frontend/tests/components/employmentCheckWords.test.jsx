import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/models/staffApiClient', () => ({ default: { get: vi.fn() } }));
// eslint-disable-next-line import/first
import staffClient from '../../src/models/staffApiClient';
// eslint-disable-next-line import/first
import AuditTrail from '../../src/components/AuditTrail';
// eslint-disable-next-line import/first
import { employmentFit, HrComment } from '../../src/views/careers/careers';

describe('employmentFit', () => {
  test("says whose move it is while employment isn't verified", () => {
    expect(employmentFit({ status: 'Pending' })).toEqual({ label: 'Waiting for HR’s check', tone: 'warn' });
    expect(employmentFit({ status: 'Discrepancy_Flagged' })).toEqual({ label: 'Check your employment details', tone: 'bad' });
    expect(employmentFit({ status: 'Missing' }, true)).toEqual({ label: 'Add your details', tone: 'warn' });
  });
});

describe('AuditTrail labels', () => {
  test("words a page's own fields and values, and leaves the rest as they were", async () => {
    staffClient.get.mockResolvedValue({ data: [{
      id: 1, action: 'Employment verified', timestamp: '2026-10-30T13:00:00Z', performedBy: { name: 'Hope', role: 'HR_Officer' },
      changes: { verificationStatus: { from: 'Discrepancy_Flagged', to: 'HR_Verified' }, salaryAmount: { from: 1, to: 2 } }
    }] });
    render(<AuditTrail entityType="InternalProfile" entityId={5}
      labels={{ verificationStatus: { label: 'Check', values: { Discrepancy_Flagged: 'Doesn’t match HR records', HR_Verified: 'Verified' } } }} />);

    await userEvent.click(screen.getByRole('button', { name: /history/i }));

    expect(await screen.findByText(/Check: Doesn’t match HR records → Verified/)).toBeInTheDocument();
    expect(screen.getByText(/Salary amount: 1 → 2/)).toBeInTheDocument();
  });
});

describe('HrComment', () => {
  test("shows HR's comment on flagged details, and nothing otherwise", () => {
    const { rerender, container } = render(<HrComment profile={{ verificationStatus: 'Discrepancy_Flagged', verificationComments: 'Employee number is UCAA1234.' }} />);
    expect(screen.getByText('Employee number is UCAA1234.')).toBeInTheDocument();
    expect(screen.getByText('HR’s comment')).toBeInTheDocument();
    rerender(<HrComment profile={{ verificationStatus: 'HR_Verified', verificationComments: 'Matches.' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
