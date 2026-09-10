import React from 'react';

// Matches UCAA's actual printed/PDF job-advertisement layout (plain
// letterhead, colon-style facts, Person Specification table) as closely
// as an HTML->canvas capture reasonably can - distinct from VacancyAdvert,
// which is styled for on-screen reading inside the app's own wizard
// theme. Only ever rendered off-screen, captured by html2canvas, and
// thrown away - see frontend/src/views/apply-wizard/JobDetailsStep.jsx.
//
// Tables are used ONLY for the two sections that are genuinely tabular
// in the source document - Principal Accountabilities (embedded in the
// pasted jobPurpose HTML) and Person Specification. Everything else
// (the facts block, Special Skills, How to Apply) is plain text/lists,
// matching the source layout - not every section gets turned into a
// table just because two of them are.
const SECTION_COLOR = '#7030A0';   // PERSON SPECIFICATION / SPECIAL SKILLS headings
const SUBLABEL_COLOR = '#1F6FC5';  // Essential/Desirable/General Knowledge row labels
const DEADLINE_COLOR = '#C00000';
const TABLE_BORDER = '#000';

const HEAD_OFFICE_CONTACTS = ['+256 414 352000', '+256 312 352000', '+256 20 0452000'];
const BODY_FONT = 'Calibri, Arial, sans-serif';

// Page margins/padding live entirely in downloadElementAsPdf.js (the PDF
// generator) - this component only controls in-page spacing between its
// own sections, not the page gutter itself.
const SECTION_GAP = 28;     // space above each major heading
const PARAGRAPH_GAP = 14;
const LIST_INDENT = 24;
const LIST_ITEM_GAP = 8;

const sectionHeadingStyle = (color) => ({ fontSize: 26, fontWeight: 700, color, margin: `${SECTION_GAP}px 0 10px` });
const bodyParagraphStyle = { margin: `0 0 ${PARAGRAPH_GAP}px`, textAlign: 'justify' };
const listStyle = { margin: '0 0 16px', paddingLeft: LIST_INDENT };

// The one numbered-list rendering used everywhere a plain <ol> is called
// for (Person Specification sub-lists, Special Skills, How to Apply), so
// indentation and item spacing can't drift between sections.
function NumberedList({ items, style, getKey }) {
  return (
    <ol style={{ ...listStyle, marginBottom: 0, ...style }}>
      {items.map((item, i) => (
        <li key={getKey ? getKey(item, i) : i} style={{ marginBottom: LIST_ITEM_GAP, paddingLeft: 4 }}>{item}</li>
      ))}
    </ol>
  );
}

const tableCellStyle = { border: `1px solid ${TABLE_BORDER}`, padding: '10px 14px', verticalAlign: 'top' };
const tableLabelCellStyle = { ...tableCellStyle, fontWeight: 700, color: SUBLABEL_COLOR, width: '30%' };

export default function VacancyAdvertPrintLayout({
  jobRef, title, reportsToName, salaryScale, positionsRequired, deadline,
  jobPurpose, essentialRequirements,
  minimumEducationLevel, minimumExperienceYears, preferredFieldOfStudy,
  desirableRequirements, generalKnowledge, specialSkills
}) {
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Minimum education/experience and preferred field of study are the
  // structured, actually-screened half of Essential Requirements (see
  // VacancyAdvert's own comment on the same split) - folded into the same
  // numbered list here as the free-text essentialRequirements bullets, so
  // the Person Specification table reads as one coherent list.
  const essentialItems = [
    ...(minimumEducationLevel ? [`Minimum education: ${minimumEducationLevel}`] : []),
    ...(minimumExperienceYears ? [`Minimum experience: ${minimumExperienceYears} year(s)`] : []),
    ...(preferredFieldOfStudy ? [`Preferred field of study: ${preferredFieldOfStudy}`] : []),
    ...(essentialRequirements || [])
  ];

  const deadlineText = deadline
    ? new Date(deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // label | colon | value, each its own column - guarantees every colon
  // lines up under the next regardless of how long "SALARY LEVEL" is next
  // to "JOB REF", rather than relying on the colon being baked into the
  // value text of a two-column layout. Plain rows, not a bordered table -
  // borders are reserved for Principal Accountabilities and Person
  // Specification, the two genuinely tabular sections.
  const facts = [
    ['JOB REF', jobRef || 'To be assigned'],
    ['POSITION', (title || '').toUpperCase()],
    ...(reportsToName ? [['REPORTS TO', reportsToName.toUpperCase()]] : []),
    ...(salaryScale ? [['SALARY LEVEL', salaryScale]] : []),
    ['VACANCIES', positionsRequired]
  ];

  const personSpecRows = [
    essentialItems.length > 0 && ['Essential Requirements', essentialItems],
    desirableRequirements?.length > 0 && ['Desirable Requirements', desirableRequirements.map((r) => r.text)],
    generalKnowledge?.length > 0 && ['General Knowledge and Cognitive Aptitude', generalKnowledge]
  ].filter(Boolean);

  return (
    <div style={{
      width: 794, boxSizing: 'border-box', fontFamily: BODY_FONT, color: '#000', fontSize: 22, lineHeight: 1, background: '#fff'
    }}>
      {/* Algerian is a decorative, Windows-bundled font - it only renders
          as Algerian if the browser generating this PDF (the candidate's
          own, since this is captured client-side) actually has it
          installed. Falls back to a bold display font, then generic
          fantasy/serif, rather than silently becoming the body sans-serif
          if it's missing. */}
      <h1 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, fontFamily: "Algerian, Impact, 'Haettenschweiler', fantasy, serif", margin: '0 0 22px' }}>
        UGANDA CIVIL AVIATION AUTHORITY
      </h1>

      <p style={bodyParagraphStyle}>
        Uganda Civil Aviation Authority (UCAA) is a corporate body responsible for regulation of civil aviation in
        Uganda and management of Entebbe International Airport (EIA) and thirteen (13) other upcountry aerodromes.
      </p>
      <p style={bodyParagraphStyle}>
        UCAA carries out its work in conformity with International Civil Aviation Organization (ICAO) Standards and
        Recommended Practices (SARPs).
      </p>
      <p style={{ ...bodyParagraphStyle, marginBottom: 24 }}>
        The Authority plans to recruit qualified Ugandans of impeccable integrity and commitment to fill the
        following position in its establishment as detailed below:
      </p>

      <table style={{ borderSpacing: 0, borderCollapse: 'collapse', marginBottom: 24 }}>
        <colgroup>
          <col style={{ width: 160 }} />
          <col style={{ width: 18 }} />
          <col />
        </colgroup>
        <tbody>
          {facts.map(([label, value]) => (
            <tr key={label}>
              <td style={{ fontWeight: 700, padding: '4px 0', verticalAlign: 'top' }}>{label}</td>
              <td style={{ padding: '4px 0', verticalAlign: 'top' }}>:</td>
              <td style={{ padding: '4px 0', verticalAlign: 'top' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {jobPurpose && (
        <>
          <h2 style={sectionHeadingStyle('#000')}>JOB PURPOSE</h2>
          {/* Sanitized rich-text HTML pasted by HR - already includes the
              Principal Accountabilities table when HR pasted it as part of
              the same block (see backend/prisma/schema.prisma's comment on
              Vacancy.jobPurpose), so no separate accountabilities section
              is rendered here.

              Word pastes carry their own per-cell border/padding (often
              inconsistent - some cells styled, some left to inherit
              Word's table-wide border that doesn't survive the paste).
              The scoped !important rules below force every table nested
              in this pasted content to the same all-borders look as the
              Person Specification table - CSS !important in a stylesheet
              rule beats a plain (non-!important) inline style regardless
              of the inline style's own specificity. */}
          <style>{`
            .pdf-job-purpose, .pdf-job-purpose * { font-size: 22px !important; line-height: 1 !important; text-align: justify; }
            .pdf-job-purpose table { width: 100% !important; border-collapse: collapse !important; margin: 14px 0 !important; }
            .pdf-job-purpose td, .pdf-job-purpose th { border: 1px solid ${TABLE_BORDER} !important; padding: 10px 14px !important; vertical-align: top !important; text-align: left; }
          `}</style>
          <div className="pdf-job-purpose" dangerouslySetInnerHTML={{ __html: jobPurpose }} />
        </>
      )}

      {personSpecRows.length > 0 && (
        <>
          <h2 style={sectionHeadingStyle(SECTION_COLOR)}>PERSON SPECIFICATIONS</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <colgroup>
              <col style={{ width: '30%' }} />
              <col />
            </colgroup>
            <tbody>
              {personSpecRows.map(([label, items]) => (
                <tr key={label}>
                  <td style={tableLabelCellStyle}>{label}</td>
                  <td style={tableCellStyle}>
                    <NumberedList items={items} style={{ marginBottom: 0 }}
                      getKey={label === 'Desirable Requirements' ? (item, idx) => desirableRequirements[idx].id || idx : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {specialSkills?.length > 0 && (
        <>
          <h2 style={sectionHeadingStyle(SECTION_COLOR)}>SPECIAL SKILLS AND ATTRIBUTES:</h2>
          <NumberedList items={specialSkills} />
        </>
      )}

      <h2 style={{ ...sectionHeadingStyle('#000'), textDecoration: 'underline' }}>HOW TO APPLY:</h2>
      <NumberedList items={[
        <>To view the above-mentioned job advertisement and apply, please visit {siteUrl || 'this system'} to create an account and start the application process.</>,
        <>Sign up to create an account (new users).</>,
        <>Log in with your username and password.</>,
        <>Create a CV by filling in all the required information before proceeding.</>,
        <>Click Home and there you will see the advertised job. To apply, click the <strong>"Apply"</strong> button. Thereafter a confirmation message will appear confirming your application was successful.</>,
        <>Please note that falsification of information is an offense at UCAA. You are advised to only apply for the jobs where you meet the minimum requirements as indicated in the job description, as well as being very sincere while responding to the application questionnaire.</>,
        <>Physical/hard copy applications will not be accepted.</>
      ]} />

      <p style={{ margin: `${SECTION_GAP}px 0 4px` }}>For any inquiries or assistance, please contact: -</p>
      <p style={{ margin: '0 0 18px' }}>Head Office: {HEAD_OFFICE_CONTACTS.join(', ')}</p>

      {deadlineText && (
        <p style={bodyParagraphStyle}>
          Applications are to be received not later than <strong style={{ color: DEADLINE_COLOR }}>5:00pm, {deadlineText}</strong>.
        </p>
      )}
      <p style={{ ...bodyParagraphStyle, fontWeight: 700, fontStyle: 'italic' }}>
        It is the duty of the applicant to ensure that his/her application is received by the indicated date and
        late applications will not be entertained under any circumstances.
      </p>
      <p style={{ fontWeight: 700, fontStyle: 'italic', margin: 0, textAlign: 'justify' }}>
        We pledge to conduct a transparent recruitment process!
      </p>
    </div>
  );
}
