import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/models/apiClient', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
// eslint-disable-next-line import/first
import client from '../../src/models/apiClient';
// eslint-disable-next-line import/first
import { ConfirmProvider } from '../../src/components/ConfirmDialog';
// eslint-disable-next-line import/first
import CvImport from '../../src/views/careers/CvImport';

// "Fill in from your CV" for a UCAA employee (Internal Careers' My profile
// and first sign-in setup): their current UCAA job is already on the profile
// from their employment details, so the CV's line for it is skipped, and no
// LinkedIn or website is taken (Internal Careers shows neither).
const INTERNAL = {
  candidateType: 'Internal', location: 'Entebbe', districtOfOrigin: '', education: [], certificates: [], examGrades: [],
  workExperience: [{ id: 1, employer: 'Uganda Civil Aviation Authority', jobTitle: 'HR Assistant', startDate: '2021-08-02T00:00:00.000Z', endDate: null, duties: [] }]
};
const READ = {
  education: [], certificates: [], examGrades: [], warnings: [],
  workExperience: [
    { employer: 'Uganda Civil Aviation Authority (UCAA)', jobTitle: 'Human Resource Assistant', startDate: '2021-08-01', endDate: null },
    { employer: 'Stanbic Bank Uganda', jobTitle: 'Customer Service Officer', startDate: '2019-07-15', endDate: '2021-07-31' }
  ],
  districtOfOrigin: 'Lira', nationalId: 'CM12345678ABCD', portfolioUrl: 'https://grace.example.com', linkedinUrl: 'https://linkedin.com/in/grace'
};

beforeEach(() => {
  vi.clearAllMocks();
  client.post.mockImplementation(async (url, body) => (url.endsWith('/parse-cv') ? { data: READ, status: 200 } : { data: { id: 99, ...body }, status: 201 }));
  client.put.mockResolvedValue({ data: {}, status: 200 });
});

test('an internal candidate\'s CV skips their current UCAA job and takes no links or NIN', async () => {
  const user = userEvent.setup();
  render(<ConfirmProvider><CvImport profile={INTERNAL} onAdded={vi.fn()} links={false} /></ConfirmProvider>);
  await user.upload(screen.getByLabelText('Upload your CV'), new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }));

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Added from your CV: 1 job and your district of origin.'));
  expect(screen.getByRole('status')).toHaveTextContent('Skipped 1 job already on your profile.');
  // Only the district went into the profile - no LinkedIn, website or NIN.
  expect(client.put).toHaveBeenCalledTimes(1);
  expect(client.put).toHaveBeenCalledWith('/api/candidates/me', { districtOfOrigin: 'Lira' });
  await waitFor(() => expect(client.post).toHaveBeenCalledWith('/api/candidates/me/work-experience', expect.objectContaining({ employer: 'Stanbic Bank Uganda' })));
  expect(client.post).not.toHaveBeenCalledWith('/api/candidates/me/work-experience', expect.objectContaining({ jobTitle: 'Human Resource Assistant' }));
});
