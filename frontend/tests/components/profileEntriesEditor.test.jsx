import React, { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import client from '../../src/models/apiClient';
import { ConfirmProvider } from '../../src/components/ConfirmDialog';
import ProfileEntriesEditor from '../../src/components/ProfileEntriesEditor';

// Education, work experience and certificates: "Add another" only opens a
// blank entry, and an entry saves itself once its required fields are filled
// - a POST the first time, a PUT after. A saved entry is one summary line
// with Edit and Delete.
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
  // It arrives folded to its summary line, flagged for checking.
  await waitFor(() => expect(screen.getByText(/From your CV - check it, especially the dates/)).toBeInTheDocument());
  expect(screen.getByText('Agent')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Entebbe Handling')).not.toBeInTheDocument();
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

test('job duties pasted as a numbered list are saved one per duty and shown as bullets', async () => {
  const user = userEvent.setup();
  renderEditor();
  await user.type(screen.getByLabelText(/Employer/), 'Uganda Airlines');
  await user.type(screen.getByLabelText(/Job title/), 'Cabin Crew');
  await user.type(screen.getByLabelText(/Start date/), '2019-03-01');
  const box = screen.getByLabelText(/Job duties/);
  await user.click(box);
  await user.paste('1. Conducted safety briefings\n2) Served passengers on regional\nroutes\n3. Wrote cabin reports');
  await user.tab();
  expect(box.value).toBe('• Conducted safety briefings\n• Served passengers on regional routes\n• Wrote cabin reports');
  await waitFor(() => expect(sent.some((r) => r.method === 'post' && r.body.duties?.length === 3)).toBe(true), { timeout: 3000 });
  const saved = [...sent].reverse().find((r) => r.url === '/api/candidates/me/work-experience' || r.url.startsWith('/api/candidates/me/work-experience/'));
  expect(saved.body.duties).toEqual(['Conducted safety briefings', 'Served passengers on regional routes', 'Wrote cabin reports']);
});

const SAVED_JOB = { id: 7, employer: 'UCAA', jobTitle: 'Records Clerk', startDate: '2018-01-01T00:00:00.000Z', endDate: null, duties: ['Filed records', 'Kept registers'] };

test('a saved entry is a summary line; Edit opens its fields, duties included, and a change saves itself', async () => {
  const user = userEvent.setup();
  renderEditor({ education: [], certificates: [], workExperience: [SAVED_JOB] });
  expect(screen.getByText('Records Clerk')).toBeInTheDocument();
  expect(screen.getByText(/UCAA · Jan 2018 – now · 2 duties/)).toBeInTheDocument();
  expect(screen.queryByDisplayValue('UCAA')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Edit job 1' }));
  expect(screen.getByLabelText(/Job duties/)).toHaveValue('• Filed records\n• Kept registers');
  // No Done per entry - the change is saved on its own.
  expect(screen.queryByRole('button', { name: /^Done/ })).not.toBeInTheDocument();
  const title = screen.getByDisplayValue('Records Clerk');
  await user.clear(title);
  await user.type(title, 'Senior Records Clerk');
  await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
    method: 'put', url: '/api/candidates/me/work-experience/7', body: expect.objectContaining({ jobTitle: 'Senior Records Clerk' })
  })), { timeout: 2000 });
});

test('finish() drops a blank new entry, saves what is waiting, and stops at one missing a required field', async () => {
  const user = userEvent.setup();
  const { ref } = renderEditor({ education: [], certificates: [], workExperience: [SAVED_JOB] });
  // The blank qualification nobody started is dropped, not reported.
  await user.click(screen.getByRole('button', { name: 'Edit job 1' }));
  await user.clear(screen.getByDisplayValue('UCAA'));
  let ok;
  await act(async () => { ok = await ref.current.finish(); });
  expect(ok).toBe(false);
  expect(screen.queryByLabelText(/Institution/)).not.toBeInTheDocument();
  expect(screen.getByText(/Fill in the employer to save it/)).toBeInTheDocument();

  await user.type(screen.getByLabelText(/Employer/), 'UCAA Entebbe');
  await act(async () => { ok = await ref.current.finish(); });
  expect(ok).toBe(true);
  expect(sent).toContainEqual(expect.objectContaining({
    method: 'put', url: '/api/candidates/me/work-experience/7', body: expect.objectContaining({ employer: 'UCAA Entebbe' })
  }));
});

test('Delete asks first, then removes the entry', async () => {
  const user = userEvent.setup();
  renderEditor({ education: [], certificates: [], workExperience: [SAVED_JOB] });
  await user.click(screen.getByRole('button', { name: 'Delete job 1' }));
  await user.click(await screen.findByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ method: 'delete', url: '/api/candidates/me/work-experience/7' })));
  expect(screen.queryByText('Records Clerk')).not.toBeInTheDocument();
});

test('focus opens that one entry (My profile\'s Edit)', () => {
  renderEditor({ education: [], certificates: [], workExperience: [SAVED_JOB, { ...SAVED_JOB, id: 8, jobTitle: 'Driver' }] }, { focus: { kind: 'workExperience', id: 8 } });
  expect(screen.getByDisplayValue('Driver')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Records Clerk')).not.toBeInTheDocument();
});

test('a CV entry missing a required field opens itself and is not sent', async () => {
  const { ref } = renderEditor();
  let added;
  act(() => { added = ref.current.addFromCv('workExperience', { employer: 'Entebbe Handling', jobTitle: '', startDate: '2015-03-01' }); });
  expect(added).toBe('incomplete');
  await waitFor(() => expect(screen.getByText(/Fill in the job title to save it/)).toBeInTheDocument());
  expect(screen.getByDisplayValue('Entebbe Handling')).toBeInTheDocument();
  expect(sent).toEqual([]);
});

test('kinds shows only that section, and startNew opens a blank entry of it', () => {
  renderEditor({ education: [], certificates: [], workExperience: [SAVED_JOB] }, { kinds: ['workExperience'], startNew: 'workExperience' });
  expect(screen.queryByText('Education')).not.toBeInTheDocument();
  expect(screen.queryByText('Professional certificates')).not.toBeInTheDocument();
  // The saved job stays a summary line; a new, empty job is open to fill in.
  expect(screen.getByText('Records Clerk')).toBeInTheDocument();
  expect(screen.getByLabelText(/Employer/)).toHaveValue('');
  expect(screen.getAllByLabelText(/Employer/)).toHaveLength(1);
});

test('educationExtra sits inside the Education section, before work experience', () => {
  renderEditor(undefined, { educationExtra: <div>O-Level and A-Level results here</div> });
  const extra = screen.getByText('O-Level and A-Level results here');
  const work = screen.getByText('Work experience');
  expect(extra.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
