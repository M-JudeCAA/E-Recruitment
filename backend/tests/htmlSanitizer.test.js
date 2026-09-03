const { sanitizeJobDescription } = require('../src/utils/htmlSanitizer');

describe('sanitizeJobDescription', () => {
  test('returns null for empty/nullish input', () => {
    expect(sanitizeJobDescription(null)).toBeNull();
    expect(sanitizeJobDescription('')).toBeNull();
    expect(sanitizeJobDescription(undefined)).toBeNull();
  });

  test('preserves bold and italic formatting', () => {
    const out = sanitizeJobDescription('<p><b>Bold</b> and <i>italic</i> text</p>');
    expect(out).toContain('<b>Bold</b>');
    expect(out).toContain('<i>italic</i>');
  });

  test('preserves list structure and markers', () => {
    const out = sanitizeJobDescription('<ul><li>First</li><li>Second</li></ul>');
    expect(out).toBe('<ul><li>First</li><li>Second</li></ul>');
  });

  test('preserves indentation (margin) on a paragraph', () => {
    const out = sanitizeJobDescription('<p style="margin-left: 40px;">Indented requirement</p>');
    expect(out).toContain('margin-left:40px');
  });

  test('preserves each margin/padding property independently (regression guard for the wildcard bug)', () => {
    const out = sanitizeJobDescription(
      '<p style="margin-top: 10px; margin-bottom: 5px; margin-left: 20px; margin-right: 20px; padding: 4px 8px;">Text</p>'
    );
    ['margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding'].forEach((prop) => {
      expect(out).toContain(prop);
    });
  });

  test('preserves a table with a merged header cell (colspan) and a windowtext border, and strips fonts from every cell', () => {
    const html = `<table style="border-collapse: collapse;">
      <tr><th colspan="2" style="font-family: Calibri; border: 1px solid windowtext;">Merged header</th></tr>
      <tr>
        <td style="font-family: Arial; font-size: 11pt; border: 1px solid windowtext;"><b>A</b></td>
        <td style="font-family: Arial; font-size: 11pt; border: 1px solid windowtext;">B</td>
      </tr>
    </table>`;
    const out = sanitizeJobDescription(html);

    expect(out).toContain('colspan="2"');
    expect(out).toContain('windowtext');
    expect(out).toContain('<b>A</b>');
    expect(out).toMatch(/<table[\s\S]*<\/table>/);
    expect(out).not.toMatch(/calibri/i);
    expect(out).not.toMatch(/arial/i);
    expect(out).not.toContain('11pt');
  });

  test('strips font-family and font-size everywhere, including inside table cells', () => {
    const out = sanitizeJobDescription(
      '<table><tr><td style="font-family: Calibri; font-size: 14pt; font-weight: bold;">Cell</td></tr></table>'
    );
    expect(out).not.toMatch(/calibri/i);
    expect(out).not.toContain('14pt');
    expect(out).toContain('font-weight:bold');
  });

  test('strips <script> tags entirely', () => {
    const out = sanitizeJobDescription('<p>Hello</p><script>alert(document.cookie)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('Hello');
  });

  test('strips onerror and other event handlers', () => {
    const out = sanitizeJobDescription('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
  });

  test('a description submitted directly via the API is still sanitized (no client involved)', () => {
    // Simulates a raw API call bypassing RichTextField's client-side cleaning entirely.
    const out = sanitizeJobDescription('<div style="font-family:Times New Roman"><script>fetch("//evil")</script>Body text</div>');
    expect(out).not.toContain('<script');
    expect(out).not.toMatch(/times new roman/i);
    expect(out).toContain('Body text');
  });

  test('removes a legacy <font> tag but keeps its text content', () => {
    const out = sanitizeJobDescription('<font face="Arial" size="5">Legacy styled text</font>');
    expect(out).not.toContain('<font');
    expect(out).toContain('Legacy styled text');
  });

  test('truncates descriptions longer than 20,000 characters', () => {
    const out = sanitizeJobDescription('<p>' + 'a'.repeat(25000) + '</p>');
    expect(out.length).toBe(20000);
  });

  test('rejects an unrecognized tag such as <iframe>', () => {
    const out = sanitizeJobDescription('<p>Text</p><iframe src="//evil.example"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  test('rejects a style value that does not match the allowlist pattern (e.g. url() injection)', () => {
    const out = sanitizeJobDescription('<p style="width: url(javascript:alert(1));">Text</p>');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('url(');
  });
});
