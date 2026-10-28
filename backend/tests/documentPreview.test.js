const { tabulateAdvertHeader } = require('../src/utils/documentPreview');

// The job advertisement layout as mammoth gives it: a heading, the
// labelled lines (the job purpose running over two paragraphs), then the JD
// table.
const JD_TABLE = '<table><tr><td><p><strong>PRINCIPAL ACCOUNTABILITIES</strong></p></td><td><p><strong>SPECIFIC ACTIVITIES</strong></p></td></tr>'
  + '<tr><td><p>Input into Strategic Planning</p></td><td><p>Participates in business planning</p></td></tr></table>';
const ADVERT = '<p><strong>UGANDA CIVIL AVIATION AUHORITY</strong></p><p><strong>INTERNAL JOB ADVERTISEMENT</strong></p>'
  + '<p>Applications are invited from suitably qualified <strong>employees</strong> of Uganda Civil Aviation Authority, as detailed below</p>'
  + '<p><strong>JOB REF : UCAA/ADV/INT/O6/2026</strong></p>'
  + '<p><strong>POSITION : MANAGER MARKETING &amp; COMMERCIAL</strong></p>'
  + '<p><strong>REPORTS TO :</strong> DEPUTY DIRECTOR GENERAL</p>'
  + '<p><strong>SALARY LEVEL : </strong>13</p>'
  + '<p><strong>VACANCIES : </strong>01</p>'
  + '<p><strong>JOB PURPOSE : </strong>The position exists to lead in the marketing and</p>'
  + '<p>commercialization of UCAA and customer engagement and retention</p>'
  + JD_TABLE + '<p>PERSON SPECIFICATIONS</p>';

describe('tabulateAdvertHeader', () => {
  it('puts the labelled lines at the top of the JD table, as one table', () => {
    const html = tabulateAdvertHeader(ADVERT);
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).toContain('<p>Applications are invited');
    expect(html).toContain('as detailed below</p><table><tr><td><p><strong>JOB REF</strong></p></td><td><p>UCAA/ADV/INT/O6/2026</p></td></tr>');
    expect(html).toContain('<tr><td><p><strong>POSITION</strong></p></td><td><p>MANAGER MARKETING &amp; COMMERCIAL</p></td></tr>');
    expect(html).toContain('<tr><td><p><strong>REPORTS TO</strong></p></td><td><p>DEPUTY DIRECTOR GENERAL</p></td></tr>');
    expect(html).toContain('<td><p>The position exists to lead in the marketing and commercialization of UCAA and customer engagement and retention</p></td></tr>'
      + '<tr><td><p><strong>PRINCIPAL ACCOUNTABILITIES</strong>');
    expect(html).toContain('</table><p>PERSON SPECIFICATIONS</p>');
  });

  it('spans the value across a wider table', () => {
    const wide = ADVERT.replace(JD_TABLE, '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr></table>');
    expect(tabulateAdvertHeader(wide)).toContain('<td colspan="2"><p>UCAA/ADV/INT/O6/2026</p></td>');
  });

  it('leaves a document alone when its tables already hold the details', () => {
    const template = '<p><strong>JOB OPENING REQUEST</strong></p><p><strong>PART A: JOB VACANCY DETAILS</strong></p><table><tr><td><p>Directorate</p></td><td><p>Corporate</p></td></tr></table>';
    expect(tabulateAdvertHeader(template)).toBe(template);
  });

  it('leaves it alone when something other than paragraphs sits before the table', () => {
    const withList = ADVERT.replace(JD_TABLE, `<ul><li>note</li></ul>${JD_TABLE}`);
    expect(tabulateAdvertHeader(withList)).toBe(withList);
  });
});
