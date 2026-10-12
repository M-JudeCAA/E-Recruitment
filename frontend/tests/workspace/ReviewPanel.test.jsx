import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReviewPanel from '../../src/components/workspace/ReviewPanel';
import staffClient from '../../src/models/staffApiClient';

vi.mock('../../src/models/staffApiClient', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/components/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }));

// The Inbox's "Review" side panel for a vacancy waiting for approval.
const vacancy = {
  id: 6, jobRef: 'UCAA/ADV/EXT/006/2026', title: 'Records Officer', postingType: 'External', positionsRequired: 2,
  deadline: '2026-10-22T20:59:59.999Z', salaryScale: 'U4', createdBy: { name: 'Alice HR' },
  department: { name: 'Human Resource', directorate: { name: 'Human Resource and Administration' } },
  requisitionDocumentName: 'Job Opening Request.docx'
};
const open = (data) => {
  staffClient.get.mockResolvedValue({ data });
  return render(
    <MemoryRouter>
      <ReviewPanel item={{ review: { type: 'vacancy', vacancyId: 6 } }} staffRole="Manager" onClose={() => {}} onDone={() => {}} />
    </MemoryRouter>
  );
};

describe('reviewing a vacancy from the Inbox', () => {
  // Every vacancy is created from a requisition, and each fact read from it
  // is kept as { label, value, confidence }. Showing that object instead of
  // its value used to blank the whole page for the approver.
  test('shows the EXCO approval read from the requisition', async () => {
    open({
      ...vacancy,
      requisitionDetails: { fields: { excoReference: { label: 'EXCO approval', value: 'EXCO MIN 34671/2026', confidence: 'high' } } }
    });
    expect(await screen.findByText('EXCO MIN 34671/2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return for changes' })).toBeInTheDocument();
  });

  test('falls back to the document\'s name when no EXCO reference was read', async () => {
    open({ ...vacancy, requisitionDetails: { fields: {} } });
    expect(await screen.findByText('Job Opening Request.docx')).toBeInTheDocument();
  });

  test('a vacancy from before requisitions still opens', async () => {
    open({ ...vacancy, requisitionDetails: null, requisitionDocumentName: null });
    expect(await screen.findByText('UCAA/ADV/EXT/006/2026')).toBeInTheDocument();
    expect(screen.getByText('Alice HR')).toBeInTheDocument();
  });

  test('warns the approver about an exception they will be asked to authorise', async () => {
    open({ ...vacancy, requisitionDetails: { fields: {}, jdException: { reason: 'Urgent' } } });
    expect(await screen.findByText(/job description is not approved/)).toBeInTheDocument();
  });

  test('says so when the item is no longer waiting', async () => {
    open(null);
    expect(await screen.findByText('This is no longer waiting for a decision.')).toBeInTheDocument();
  });
});
