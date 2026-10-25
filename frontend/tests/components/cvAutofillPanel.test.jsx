import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import client from '../../src/models/apiClient';
import CvAutofillPanel from '../../src/components/CvAutofillPanel';

// A CV is read and everything in it goes straight into the form - no list
// of suggestions to add one by one - with a summary of what went in and
// what was skipped.
const READ = {
  education: [{ institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Law' }],
  workExperience: [{ employer: 'UCAA', jobTitle: 'Clerk' }, { employer: 'URA', jobTitle: 'Officer' }, { employer: 'NWSC', jobTitle: 'Intern' }],
  certificates: [],
  location: 'Kampala', districtOfOrigin: 'Gulu',
  linkedinUrl: 'https://linkedin.com/in/someone',
  examGrades: [{ level: 'OLevel', subject: 'Maths', grade: 'D1' }],
  warnings: ['Two dates could not be read.']
};

beforeEach(() => {
  localStorage.setItem('candidateToken', 'candidate-jwt');
  client.defaults.adapter = async (config) => ({ data: READ, status: 200, statusText: 'OK', headers: {}, config });
});

test('everything read is added at once, and the panel says what went in and what was skipped', async () => {
  const user = userEvent.setup();
  const handlers = {
    onEducationSuggested: vi.fn(() => true),
    // The profile already has the URA job.
    onWorkExperienceSuggested: vi.fn((w) => (w.employer === 'URA' ? false : w.employer === 'NWSC' ? 'incomplete' : true)),
    onCertificateSuggested: vi.fn(() => true),
    onPersonalSuggested: vi.fn(async () => ['District of origin']),
    onLinkedinSuggested: vi.fn(() => true),
    onExamGradesSuggested: vi.fn(async () => 1)
  };
  render(<CvAutofillPanel {...handlers} />);
  await user.upload(screen.getByLabelText('Upload your CV'), new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }));

  await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  expect(handlers.onEducationSuggested).toHaveBeenCalledTimes(1);
  expect(handlers.onWorkExperienceSuggested).toHaveBeenCalledTimes(3);
  expect(handlers.onPersonalSuggested).toHaveBeenCalledWith({ location: 'Kampala', districtOfOrigin: 'Gulu' });
  expect(handlers.onLinkedinSuggested).toHaveBeenCalledWith('https://linkedin.com/in/someone');
  expect(handlers.onExamGradesSuggested).toHaveBeenCalledWith(READ.examGrades);

  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Added from your CV: 1 qualification, 2 jobs, your district of origin, your LinkedIn and 1 O-Level / A-Level result.');
  expect(status).toHaveTextContent('Skipped 1 job already on your profile.');
  // The NWSC job came without something required, so it waits open to be finished.
  expect(status).toHaveTextContent('1 job still needs a detail the CV did not give - open below for you to fill in.');
  expect(status).toHaveTextContent('Two dates could not be read.');
  // No buttons to add things one by one.
  expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();
});
