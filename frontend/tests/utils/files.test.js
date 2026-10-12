import { MAX_DOCUMENT_SIZE, validateDocumentFile, validateSupportingDocumentFile } from '../../src/utils/fileValidation';
import { downloadCsv } from '../../src/utils/csvDownload';
import { safeJsonParse } from '../../src/utils/safeJsonParse';
import { debounce } from '../../src/utils/debounce';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const file = (name, type, size = 1024) => ({ name, type, size });

// A faster "no" in the browser - middleware/upload.js is the real check.
describe('checking a file before it is uploaded', () => {
  test('PDF and Word documents are accepted', () => {
    expect(validateDocumentFile(file('cv.pdf', PDF))).toBe('');
    expect(validateDocumentFile(file('cover letter.docx', DOCX))).toBe('');
    expect(validateDocumentFile(file('old.doc', 'application/msword'))).toBe('');
  });

  test('anything else is refused, whatever it is called', () => {
    expect(validateDocumentFile(file('photo.png', 'image/png'))).toMatch(/Only PDF or Word/);
    expect(validateDocumentFile(file('cv.pdf', 'application/x-msdownload'))).toMatch(/Only PDF or Word/);
  });

  test('a file the browser gives no type for goes by its extension', () => {
    expect(validateDocumentFile(file('CV.PDF', ''))).toBe('');
    expect(validateDocumentFile(file('cv.exe', ''))).toMatch(/Only PDF or Word/);
  });

  test('at most 10MB', () => {
    expect(validateDocumentFile(file('cv.pdf', PDF, MAX_DOCUMENT_SIZE))).toBe('');
    expect(validateDocumentFile(file('cv.pdf', PDF, MAX_DOCUMENT_SIZE + 1))).toMatch(/10MB/);
  });

  test('supporting documents may also be scans', () => {
    expect(validateSupportingDocumentFile(file('certificate.jpg', 'image/jpeg'))).toBe('');
    expect(validateSupportingDocumentFile(file('certificate.png', ''))).toBe('');
    expect(validateSupportingDocumentFile(file('clip.mp4', 'video/mp4'))).toMatch(/PDF, Word, JPG or PNG/);
    expect(validateSupportingDocumentFile(file('scan.png', 'image/png', MAX_DOCUMENT_SIZE + 1))).toMatch(/10MB/);
  });

  test('no file chosen is not an error', () => {
    expect(validateDocumentFile(null)).toBe('');
    expect(validateSupportingDocumentFile(undefined)).toBe('');
  });
});

describe('saving a list as CSV', () => {
  // What the browser would have saved, as text.
  async function saved(columns, rows) {
    let blob;
    URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:test'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadCsv('vacancies.csv', columns, rows);
    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    return { text, blob };
  }
  const columns = [{ header: 'Title', value: (r) => r.title }, { header: 'Posts', value: (r) => r.posts }];

  test('one line per row, ending in CRLF, as a CSV file', async () => {
    const { text, blob } = await saved(columns, [{ title: 'HR Officer', posts: 2 }, { title: 'Pilot', posts: 1 }]);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(text.replace(/^﻿/, '')).toMatch(/Title,Posts\r\nHR Officer,2\r\nPilot,1\r\n$/);
  });

  test('quotes commas, quotes and line breaks', async () => {
    const { text } = await saved(columns, [{ title: 'Officer, "Senior"\nGrade 2', posts: 1 }]);
    expect(text).toContain('"Officer, ""Senior""\nGrade 2",1');
  });

  // The same protection as backend utils/csv.js.
  test.each(['=1+1', '+256', '-2', '@SUM(A1)'])('text starting like a formula (%s) can\'t run in a spreadsheet', async (title) => {
    const { text } = await saved(columns, [{ title, posts: 1 }]);
    expect(text).toContain(`\r\n'${title},1\r\n`);
  });

  test('empty values are empty cells, and numbers stay numbers', async () => {
    const { text } = await saved(columns, [{ title: null, posts: 0 }, { title: undefined, posts: NaN }, { title: 'x', posts: -3 }]);
    expect(text).toMatch(/Title,Posts\r\n,0\r\n,\r\nx,-3\r\n$/);
  });
});

describe('small helpers', () => {
  test('a stored JSON field that is broken or empty falls back instead of throwing', () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(['a', 'b']);
    expect(safeJsonParse('{"half":', [])).toEqual([]);
    expect(safeJsonParse(null, 'none')).toBe('none');
    expect(safeJsonParse('', [])).toEqual([]);
  });

  test('a burst of calls runs once, with the last arguments', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const debounced = debounce(refetch, 300);
    debounced('first');
    debounced('second');
    debounced('third');
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith('third');
    vi.useRealTimers();
  });
});
