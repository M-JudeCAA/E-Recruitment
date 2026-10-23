const { splitDuties, dutiesToText } = require('../src/utils/dutyList');

// Job duties pasted into one box, however the list was written.

describe('splitDuties', () => {
  test.each([
    ['bullets', '• Prepared statements\n• Reconciled accounts', ['Prepared statements', 'Reconciled accounts']],
    ["Word's symbol-font bullets", ' Prepared statements\n Reconciled accounts', ['Prepared statements', 'Reconciled accounts']],
    ['numbers', '1. Prepared statements\n2) Reconciled accounts\n(3) Audited stores', ['Prepared statements', 'Reconciled accounts', 'Audited stores']],
    ['letters and roman numerals', 'a) One\nb. Two\niv. Four', ['One', 'Two', 'Four']],
    ['dashes and asterisks', '- One\n* Two\n– Three', ['One', 'Two', 'Three']],
    ['bullets on one line', '• One • Two • three', ['One', 'Two', 'three']],
    ['plain lines', 'did one thing\ndid another', ['did one thing', 'did another']]
  ])('%s', (what, text, expected) => {
    expect(splitDuties(text)).toEqual(expected);
  });

  test('a wrapped line of a list joins the duty above it', () => {
    expect(splitDuties('1. Maintained the network across\nall regional airports\n2. Trained staff')).toEqual([
      'Maintained the network across all regional airports', 'Trained staff'
    ]);
  });

  test('keeps "e.g." and figures at the start of a line', () => {
    expect(splitDuties('- e.g. stores\n10.5% more sales')).toEqual(['e.g. stores', '10.5% more sales']);
  });

  test('takes a list too, and drops empty lines', () => {
    expect(splitDuties(['• One', '', '  Two  '])).toEqual(['One', 'Two']);
    expect(splitDuties(null)).toEqual([]);
  });

  test('round-trips through the text box', () => {
    expect(splitDuties(dutiesToText(['One', 'Two']))).toEqual(['One', 'Two']);
  });
});
