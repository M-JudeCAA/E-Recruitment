import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentsStep, { uploadError } from '../../src/views/apply-wizard/DocumentsStep';
import { evidenceRequirements } from '../../src/utils/screeningEvidence';

// UAT-031: academic evidence is listed under Academic documents (uploaded
// once, described against it); "Evidence for this role" keeps the rest.
const vacancy = {
  minimumCGPA: 3, minimumAge: 21,
  disqualifyingRequirements: [{ id: 'd1', text: 'Degree in IT?', evidenceRequired: true, evidenceLabel: 'Degree certificate or academic transcript' }]
};

const renderStep = (documents = []) => render(
  <DocumentsStep coverLetter={null} setCoverLetter={() => {}} applicationId={1} documents={documents} onDocumentsChange={() => {}}
    evidence={evidenceRequirements(vacancy, { d1: true })} />
);

test('academic evidence is listed under Academic documents, not asked for again', () => {
  renderStep();
  const asked = screen.getByText(/This role asks for this academic evidence/).parentElement;
  expect(within(asked).getByText(/Academic transcript showing your CGPA/)).toBeInTheDocument();
  expect(within(asked).getByText(/Degree certificate or academic transcript/)).toBeInTheDocument();
  // Only the proof of age is left as separate evidence.
  expect(screen.getByText('Evidence for this role')).toBeInTheDocument();
  expect(screen.getByText('Proof of your date of birth')).toBeInTheDocument();
  expect(screen.getAllByText(/Academic transcript showing your CGPA/)).toHaveLength(1);
});

test('an academic document can be attached only once it is described', async () => {
  const user = userEvent.setup();
  renderStep();
  const input = () => document.querySelectorAll('input[type=file]')[1];
  expect(input()).toBeDisabled();
  await user.type(screen.getAllByLabelText(/Description/)[0], 'BSc IT transcript');
  expect(input()).not.toBeDisabled();
});

test('every upload states the limit, and a failure says what to do', () => {
  renderStep();
  expect(screen.getAllByText(/up to 10 MB/).length).toBeGreaterThan(2);
  expect(uploadError({ code: 'ECONNABORTED' })).toMatch(/took too long/);
  expect(uploadError({})).toMatch(/connection was lost/);
  expect(uploadError({ response: { status: 413 } })).toMatch(/10 MB/);
  expect(uploadError({ response: { status: 400, data: { error: 'Nope' } } })).toBe('Nope');
});

test('academic evidence uploaded separately on an older draft is shown with the academic documents', () => {
  renderStep([{ id: 9, category: 'Evidence', evidenceKey: 'transcript', label: 'Academic transcript showing your CGPA', fileUrl: '/api/files/x.pdf', originalName: 'transcript.pdf' }]);
  expect(screen.getByText(/transcript\.pdf/)).toBeInTheDocument();
});
