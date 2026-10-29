import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/models/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
// eslint-disable-next-line import/first
import client from '../../src/models/apiClient';
// eslint-disable-next-line import/first
import ApplicantSurvey from '../../src/views/careers/ApplicantSurvey';

// The survey that pops up on Internal Careers once an application is submitted.
const onClose = vi.fn();
beforeEach(() => vi.clearAllMocks());


test('it is not offered again once this application has feedback', async () => {
  client.get.mockResolvedValue({ data: { answered: true } });
  const { container } = render(<ApplicantSurvey applicationId={4} onClose={onClose} />);
  await waitFor(() => expect(client.get).toHaveBeenCalledWith('/api/feedback/application-survey/4'));
  expect(container).toBeEmptyDOMElement();
});

test('the ratings and the problem question must be answered before it is sent', async () => {
  client.get.mockResolvedValue({ data: { answered: false } });
  client.post.mockResolvedValue({ data: { id: 1 } });
  render(<ApplicantSurvey applicationId={4} onClose={onClose} />);
  expect(await screen.findByRole('dialog', { name: 'How did applying go?' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
  expect(screen.getByText(/Please answer the rating questions/)).toBeInTheDocument();
  expect(client.post).not.toHaveBeenCalled();

  const groups = screen.getAllByRole('radiogroup');
  for (const [i, n] of [[0, '4'], [1, '5'], [2, '3']]) {
    await userEvent.click(Array.from(groups[i].querySelectorAll('button')).find((b) => b.textContent === n));
  }
  await userEvent.click(screen.getByRole('radio', { name: '15 to 30 minutes' }));
  await userEvent.click(screen.getByRole('radio', { name: 'Yes' }));
  await userEvent.type(screen.getByLabelText('What went wrong, or what was confusing?'), 'Upload was slow');
  await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

  await screen.findByText(/Thank you for your feedback/);
  expect(client.post).toHaveBeenCalledWith('/api/feedback/application-survey', expect.objectContaining({
    applicationId: 4, overallRating: 4, easeRating: 5, clarityRating: 3, timeTaken: '15to30', hadProblems: true, problems: 'Upload was slow'
  }));
  expect(onClose).not.toHaveBeenCalled();
  // The thank-you stays up until the candidate closes it (the footer's Close, after the corner's).
  await userEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('it can be skipped or closed without sending anything', async () => {
  client.get.mockResolvedValue({ data: { answered: false } });
  render(<ApplicantSurvey applicationId={4} onClose={onClose} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(client.post).not.toHaveBeenCalled();
});
