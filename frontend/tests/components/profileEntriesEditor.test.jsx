import React, { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import client from '../../src/models/apiClient';
import { ConfirmProvider } from '../../src/components/ConfirmDialog';
import ProfileEntriesEditor from '../../src/components/ProfileEntriesEditor';

// Education, work experience and certificates are edited in place: "Add
// another" only opens a blank entry, and an entry saves itself once its
// required fields are filled - a POST the first time, a PUT after.
let sent;
let nextId;
beforeEach(() => {
  sent = [];
  nextId = 100;
  localStorage.setItem('candidateToken', 'candidate-jwt');
  client.defaults.adapter = async (config) => {
    const body = config.data ? JSON.parse(config.data) : null;
    sent.push({ method: config.method, url: config.url, body });
    const data = config.method === 'post' ? { id: nextId++, ...body } : {};
    return { data, status: config.method === 'post' ? 201 : 200, statusText: 'OK', headers: {}, config };
  };
});

const renderEditor = (profile = { education: [], workExperience: [], certificates: [] }, props = {}) => {
  const ref = createRef();
  const onSaved = vi.fn();
  render(<ConfirmProvider><ProfileEntriesEditor ref={ref} profile={profile} onSaved={onSaved} {...props} /></ConfirmProvider>);
  return { ref, onSaved };
};

test('starts with a blank qualification and job to fill in, and adding one saves nothing', async () => {
  const user = userEvent.setup();
  renderEditor();
  expect(screen.getAllByLabelText(/Institution/)).toHaveLength(1);
  expect(screen.getAllByLabelText(/Employer/)).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: /Add another qualification/ }));
  expect(screen.getAllByLabelText(/Institution/)).toHaveLength(2);
  await new Promise((r) => setTimeout(r, 900));
  expect(sent).toEqual([]);
});

test('an entry saves itself once its required fields are filled, then updates in place', async () => {
  const user = userEvent.setup();
  const { onSaved } = renderEditor();
  await user.type(screen.getByLabelText(/Institution/), 'Makerere University');
  await user.selectOptions(screen.getByLabelText(/Qualification level/), 'Bachelors');
  await user.type(screen.getByLabelText(/Field of study/), 'Computer Science');

  await waitFor(() => expect(sent.filter((r) => r.method === 'post')).toHaveLength(1), { timeout: 2000 });
  expect(sent[0]).toEqual(expect.objectContaining({
    url: '/api/candidates/me/education',
    body: expect.objectContaining({ institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Computer Science' })
  }));
  await waitFor(() => expect(screen.getByText(/Saved/)).toBeInTheDocument());
  expect(onSaved).toHaveBeenCalled();

  await user.type(screen.getByLabelText(/Year completed/), '2019');
  await waitFor(() => expect(sent.some((r) => r.method === 'put')).toBe(true), { timeout: 2000 });
  expect(sent.find((r) => r.method === 'put')).toEqual(expect.objectContaining({
    url: '/api/candidates/me/education/100', body: expect.objectContaining({ yearCompleted: 2019 })
  }));
  expect(sent.filter((r) => r.method === 'post')).toHaveLength(1);
});

test('an incomplete entry is not sent, and says what it still needs', async () => {
  const user = userEvent.setup();
  renderEditor();
  await user.type(screen.getByLabelText(/Employer/), 'Uganda Airlines');
  await waitFor(() => expect(screen.getByText(/Fill in the job title and start date to save it/)).toBeInTheDocument(), { timeout: 2000 });
  expect(sent).toEqual([]);
});

test('a CV suggestion becomes a saved entry, and one already there is skipped', async () => {
  const { ref } = renderEditor({
    education: [], certificates: [],
    workExperience: [{ id: 7, employer: 'UCAA', jobTitle: 'Clerk', startDate: '2018-01-01T00:00:00.000Z', endDate: null, duties: [] }]
  });
  let added;
  act(() => { added = ref.current.addFromCv('workExperience', { employer: 'UCAA', jobTitle: 'Clerk', startDate: '2018-01-01' }); });
  expect(added).toBe(false);
  act(() => { added = ref.current.addFromCv('workExperience', { employer: 'Entebbe Handling', jobTitle: 'Agent', startDate: '2015-03-01T00:00:00.000Z', duties: ['Check-in'] }); });
  expect(added).toBe(true);
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toEqual(expect.objectContaining({
    method: 'post', url: '/api/candidates/me/work-experience',
    body: expect.objectContaining({ employer: 'Entebbe Handling', startDate: '2015-03-01', duties: ['Check-in'] })
  }));
  await waitFor(() => expect(screen.getByText(/from your CV, check the dates/)).toBeInTheDocument());
});

test('flush() sends what is still waiting', async () => {
  const user = userEvent.setup();
  const { ref } = renderEditor();
  await user.type(screen.getByLabelText(/Institution/), 'Kyambogo');
  await user.selectOptions(screen.getByLabelText(/Qualification level/), 'Diploma');
  await user.type(screen.getByLabelText(/Field of study/), 'Accounting');
  await act(() => ref.current.flush());
  expect(sent.filter((r) => r.method === 'post' && r.url === '/api/candidates/me/education')).toHaveLength(1);
});
