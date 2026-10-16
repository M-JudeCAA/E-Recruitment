import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatAs, needsCasing } from '../../src/utils/textCase';
import TextField from '../../src/components/TextField';

// Mirrors backend/src/utils/textCase.js - change both together.
describe('formatAs', () => {
  test.each([
    ['name', 'JANE NAKATO', 'Jane Nakato'],
    ['name', 'MCDONALD OKELLO', 'McDonald Okello'],
    ['name', "o'brien mary", "O'Brien Mary"],
    ['name', 'ma li', 'Ma Li'],
    ['name', 'JMK', 'JMK'],
    ['title', 'EIC OJT', 'EIC OJT'],
    ['name', 'Jan van der Merwe', 'Jan van der Merwe'],
    ['title', 'MANAGER MARKETING & COMMERCIAL', 'Manager Marketing & Commercial'],
    ['title', 'ict systems support officer', 'ICT Systems Support Officer'],
    ['title', 'KCCA', 'KCCA'],
    ['title', 'iOS Developer', 'iOS Developer'],
    ['code', ' dhra ', 'DHRA'],
    ['email', ' Jane@Gmail.com', 'jane@gmail.com'],
    ['text', '  LEAVE ME  ', 'LEAVE ME']
  ])('%s "%s" -> "%s"', (kind, typed, stored) => {
    expect(formatAs(kind, typed)).toBe(stored);
  });

  test('only all capitals or all lower case is re-cased', () => {
    expect(needsCasing('ABC')).toBe(true);
    expect(needsCasing('Abc')).toBe(false);
  });
});

describe('a TextField with format', () => {
  function Field({ format }) {
    const [value, setValue] = useState('');
    return (
      <>
        <TextField label="Employer" format={format} value={value} onChange={(e) => setValue(e.target.value)} />
        <span data-testid="value">{value}</span>
      </>
    );
  }

  test('tidies the value when the field is left', async () => {
    render(<Field format="title" />);
    await userEvent.type(screen.getByLabelText('Employer'), 'UGANDA CIVIL AVIATION AUTHORITY');
    expect(screen.getByTestId('value')).toHaveTextContent('UGANDA CIVIL AVIATION AUTHORITY');
    await userEvent.tab();
    expect(screen.getByTestId('value')).toHaveTextContent('Uganda Civil Aviation Authority');
  });

  test('without format, leaves it as typed', async () => {
    render(<Field />);
    await userEvent.type(screen.getByLabelText('Employer'), 'UGANDA');
    await userEvent.tab();
    expect(screen.getByTestId('value')).toHaveTextContent('UGANDA');
  });
});
