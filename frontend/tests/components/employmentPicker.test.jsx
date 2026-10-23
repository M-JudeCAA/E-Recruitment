import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import client from '../../src/models/apiClient';
import SuggestField, { matchOptions } from '../../src/components/SuggestField';
import { EmploymentForm } from '../../src/views/careers/forms';

vi.mock('../../src/models/entraAuth', () => ({
  // The UCAA directory has nothing to fill in for these tests.
  myDirectoryProfile: vi.fn(() => Promise.resolve({})),
  isEntraConfigured: () => false,
  searchStaffDirectory: vi.fn()
}));

// An internal candidate picks their department and position from UCAA's
// organisation structure as they type - nothing typed counts until picked.
const ORG = {
  departments: [
    { id: 4, code: 'IT', name: 'Information Technology', directorate: { code: 'CORP', name: 'Corporate' } },
    { id: 5, code: 'FIN', name: 'Finance', directorate: { code: 'CORP', name: 'Corporate' } }
  ],
  positions: [
    { id: 40, code: 'SO', name: 'Systems Officer', departmentId: 4 },
    { id: 41, code: 'ITSSO', name: 'IT Systems Support Officer', departmentId: 4 },
    { id: 50, code: 'ACC', name: 'Accountant', departmentId: 5 }
  ]
};
let sent;
beforeEach(() => {
  sent = [];
  localStorage.setItem('candidateToken', 'candidate-jwt');
  client.defaults.adapter = async (config) => {
    sent.push(config);
    const data = config.url === '/api/candidates/me/organisation' ? ORG : {};
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
});

describe('matchOptions', () => {
  test('every word typed must appear in the name or the detail', () => {
    const options = [{ id: 1, label: 'Information Technology', detail: 'IT · Corporate' }, { id: 2, label: 'Finance', detail: 'FIN · Corporate' }];
    expect(matchOptions(options, 'info tech').map((o) => o.id)).toEqual([1]);
    expect(matchOptions(options, 'corporate').map((o) => o.id)).toEqual([1, 2]);
    expect(matchOptions(options, 'law')).toEqual([]);
  });
});

test('SuggestField hands the picked option over, by click or Enter', async () => {
  const onPick = vi.fn();
  function Field() {
    const [value, setValue] = React.useState('');
    return <SuggestField label="Department" value={value} options={[{ id: 4, label: 'Information Technology' }]} onType={setValue} onPick={onPick} />;
  }
  render(<Field />);
  await userEvent.type(screen.getByRole('combobox', { name: /Department/ }), 'inform');
  await userEvent.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith({ id: 4, label: 'Information Technology' });
});

describe('the employment form', () => {
  const me = { fullName: 'Jane Nakato', email: 'jane@caa.co.ug', internalProfile: { employeeId: 'E1', dateJoined: '2017-03-01' } };
  const renderForm = () => {
    let save;
    render(<EmploymentForm me={me} bind={(fn) => { save = fn; }} />);
    return () => save();
  };

  test('department first, then only that department\'s positions; the ids are saved', async () => {
    const save = renderForm();
    const position = screen.getByRole('combobox', { name: /Job title/ });
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Department/ })).not.toBeDisabled());
    expect(position).toBeDisabled();

    await userEvent.type(screen.getByRole('combobox', { name: /Department/ }), 'tech');
    await userEvent.click(screen.getByRole('option', { name: /Information Technology/ }));
    expect(position).not.toBeDisabled();

    await userEvent.click(position);
    // Finance's Accountant is not offered.
    expect(screen.queryByRole('option', { name: /Accountant/ })).not.toBeInTheDocument();
    await userEvent.type(position, 'support');
    await userEvent.click(screen.getByRole('option', { name: /IT Systems Support Officer/ }));

    expect(await save()).toBe(true);
    const put = sent.find((c) => c.method === 'put');
    expect(JSON.parse(put.data)).toEqual(expect.objectContaining({ departmentId: 4, positionId: 41 }));
  });

  test('a department or position typed but not picked is not saved', async () => {
    const save = renderForm();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Department/ })).not.toBeDisabled());
    await userEvent.type(screen.getByRole('combobox', { name: /Department/ }), 'Informat');
    expect(await save()).toBe(false);
    expect(screen.getByText(/Department, picked from the list/)).toBeInTheDocument();
    expect(sent.some((c) => c.method === 'put')).toBe(false);
  });

  test('a profile from before, with names typed in, is matched to the lists where the names agree', async () => {
    let save;
    render(<EmploymentForm me={{ ...me, internalProfile: { ...me.internalProfile, department: 'IT', position: 'Systems Officer' } }} bind={(fn) => { save = fn; }} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Department/ })).toHaveValue('Information Technology'));
    expect(screen.getByRole('combobox', { name: /Job title/ })).toHaveValue('Systems Officer');
    expect(await save()).toBe(true);
    expect(JSON.parse(sent.find((c) => c.method === 'put').data)).toEqual(expect.objectContaining({ departmentId: 4, positionId: 40 }));
  });
});
