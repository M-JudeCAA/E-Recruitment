const { formatAs, formatFields, casing, needsCasing } = require('../src/utils/textCase');

// How names and titles are cased when saved (utils/textCase.js).
describe('names', () => {
  test.each([
    ['JANE NAKATO', 'Jane Nakato'],
    ['jane nakato', 'Jane Nakato'],
    ['MCDONALD OKELLO', 'McDonald Okello'],
    ["o'brien  mary", "O'Brien Mary"],
    ['VAN DER MERWE JAN', 'Van der Merwe Jan'],
    ['nakato-mukasa sarah', 'Nakato-Mukasa Sarah'],
    ['JOHN OKELLO II', 'John Okello II'],
    // A surname that is also an acronym stays a name.
    ['ma li', 'Ma Li'],
    // Initials typed in capitals are left alone.
    ['JMK', 'JMK']
  ])('"%s" -> "%s"', (typed, stored) => {
    expect(formatAs('name', typed)).toBe(stored);
  });

  test('a name typed in mixed case is kept exactly', () => {
    expect(formatAs('name', 'Jan van der Merwe')).toBe('Jan van der Merwe');
    expect(formatAs('name', 'DeShawn McIntyre')).toBe('DeShawn McIntyre');
    expect(formatAs('name', '  Jane   Nakato ')).toBe('Jane Nakato');
  });
});

describe('titles', () => {
  test.each([
    ['MANAGER MARKETING & COMMERCIAL', 'Manager Marketing & Commercial'],
    ['ict systems support officer', 'ICT Systems Support Officer'],
    ['DIRECTOR OF HUMAN RESOURCE & ADMINISTRATION', 'Director of Human Resource & Administration'],
    ['bachelor of science in computer science', 'Bachelor of Science in Computer Science'],
    ['UGANDA REVENUE AUTHORITY (URA)', 'Uganda Revenue Authority (URA)'],
    ['MAKERERE UNIVERSITY (MUBS)', 'Makerere University (MUBS)'],
    ['air traffic controller ii', 'Air Traffic Controller II'],
    ['NWSC STORES MANAGER', 'NWSC Stores Manager'],
    ['EIC OJT', 'EIC OJT'],
    ['head of it', 'Head of IT'],
    ['the institute of certified public accountants', 'The Institute of Certified Public Accountants']
  ])('"%s" -> "%s"', (typed, stored) => {
    expect(formatAs('title', typed)).toBe(stored);
  });

  test('an acronym it does not know, typed on its own in capitals, is left alone', () => {
    expect(formatAs('title', 'KCCA')).toBe('KCCA');
    expect(formatAs('title', 'NWSC')).toBe('NWSC');
  });

  test('a title typed in mixed case is kept exactly', () => {
    expect(formatAs('title', 'iOS Developer')).toBe('iOS Developer');
    expect(formatAs('title', 'Ict officer')).toBe('Ict officer');
  });
});

describe('other kinds', () => {
  test('codes are upper case, emails lower case, written text only trimmed', () => {
    expect(formatAs('code', ' dhra ')).toBe('DHRA');
    expect(formatAs('email', ' Jane.Nakato@Gmail.com ')).toBe('jane.nakato@gmail.com');
    expect(formatAs('text', '  I WANT THIS JOB.  ')).toBe('I WANT THIS JOB.');
  });

  test('anything that is not a string passes through', () => {
    expect(formatAs('name', null)).toBeNull();
    expect(formatAs('title', undefined)).toBeUndefined();
    expect(formatAs('name', 5)).toBe(5);
  });

  test('needsCasing is only for all capitals or all lower case', () => {
    expect(needsCasing('ABC DEF')).toBe(true);
    expect(needsCasing('abc def')).toBe(true);
    expect(needsCasing('Abc def')).toBe(false);
    expect(needsCasing('2026')).toBe(false);
  });
});

describe('applying it', () => {
  test('formatFields formats only the fields named', () => {
    expect(formatFields({ name: 'JANE NAKATO', note: 'KEEP AS IS' }, { name: 'name' })).toEqual({ name: 'Jane Nakato', note: 'KEEP AS IS' });
  });

  test('the middleware formats the request body, including rows of a list', () => {
    const req = {
      body: {
        employer: 'UGANDA CIVIL AVIATION AUTHORITY', duties: 'LEAVE ME',
        panel: [{ name: 'okello john', trade: 'ATC' }]
      }
    };
    const next = jest.fn();
    casing({ employer: 'title', panel: { name: 'name' } })(req, {}, next);
    expect(req.body).toEqual({
      employer: 'Uganda Civil Aviation Authority', duties: 'LEAVE ME',
      panel: [{ name: 'Okello John', trade: 'ATC' }]
    });
    expect(next).toHaveBeenCalled();
  });

  test('a field the request did not send is not added', () => {
    const req = { body: {} };
    casing({ name: 'name' })(req, {}, () => {});
    expect(req.body).toEqual({});
  });
});
