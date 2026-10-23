const { extractFieldsFromText, readRange, headingOf } = require('../src/utils/cvHeuristics');
const CV = require('./fixtures/cvSamples');

// The CV reader against CVs laid out in the ways candidates send them.

describe('dates', () => {
  test.each([
    ['Jan 2019 - Present', { start: '2019-01-01', end: '', current: true }],
    ['March 2016 to date', { start: '2016-03-01', end: '', current: true }],
    ['2015 - 2018', { start: '2015-01-01', end: '2018-01-01', current: false }],
    ['03/2018 - 11/2020', { start: '2018-03-01', end: '2020-11-01', current: false }],
    ["Sept '19 - Aug '21", { start: '2019-09-01', end: '2021-08-01', current: false }],
    ['since 2020', { start: '2020-01-01', end: '', current: true }],
    ['2019-04 till date', { start: '2019-04-01', end: '', current: true }]
  ])('%s', (text, expected) => {
    expect(readRange(text)).toEqual(expect.objectContaining(expected));
  });
});

describe('headings', () => {
  test.each([
    ['ACADEMIC QUALIFICATIONS', 'education'], ['Educational Background:', 'education'], ['1. EDUCATION', 'education'],
    ['EMPLOYMENT RECORD', 'workExperience'], ['Work Experience (most recent first)', 'workExperience'], ['Professional Experience', 'workExperience'],
    ['TRAININGS ATTENDED', 'certificates'], ['Licences & Certifications', 'certificates'],
    ['REFEREES', 'other'], ['Key Skills', 'other'], ['O-LEVEL RESULTS', 'oLevel'], ['UACE', 'aLevel']
  ])('%s is %s', (line, section) => {
    expect(headingOf(line)).toEqual(expect.objectContaining({ section }));
  });

  test('a name or an employer in capitals is not a heading', () => {
    expect(headingOf('NAKATO SARAH MIREMBE')).toBeNull();
    expect(headingOf('UGANDA AIRLINES')).toBeNull();
  });
});

describe('a Ugandan CV with labelled details and a qualifications table', () => {
  const r = extractFieldsFromText(CV.LABELLED);

  test('reads the personal details', () => {
    expect(r).toEqual(expect.objectContaining({
      fullName: 'Nakato Sarah Mirembe', email: 'sarah.nakato@gmail.com', phone: '0772 123456',
      nationalId: 'CF90012345678A', dateOfBirth: '1990-03-12', districtOfOrigin: 'Mukono', location: 'Ntinda, Kampala'
    }));
  });

  test('reads every row of the table, not its header', () => {
    expect(r.education).toEqual([
      expect.objectContaining({ institution: 'Makerere University', qualificationLevel: 'Bachelors', fieldOfStudy: 'Computer Science', yearCompleted: 2012 }),
      expect.objectContaining({ institution: "St. Mary's College Kisubi", qualificationLevel: 'Certificate', fieldOfStudy: 'Uganda Advanced Certificate of Education (UACE)', yearCompleted: 2008 }),
      expect.objectContaining({ institution: 'Gayaza High School', fieldOfStudy: 'Uganda Certificate of Education (UCE)', yearCompleted: 2006 })
    ]);
  });

  test('reads "Position:/Organisation:/Period:" entries with their duties', () => {
    expect(r.workExperience).toEqual([
      {
        jobTitle: 'Systems Administrator', employer: 'Uganda Revenue Authority', startDate: '2016-03-01', endDate: '',
        duties: ["Administering the authority's Windows and Linux servers", 'Managing backups and disaster recovery', 'Supervising two junior officers']
      },
      {
        jobTitle: 'IT Officer', employer: 'Mukono District Local Government', startDate: '2013-01-01', endDate: '2016-02-01',
        duties: ["Maintaining the district's network", 'Training staff on new systems']
      }
    ]);
  });

  test('reads trainings as certificates, and stops at the referees', () => {
    expect(r.certificates).toEqual([
      { name: 'Cisco Certified Network Associate (CCNA)', issuingOrganization: 'Cisco Networking Academy', issueDate: '2014-01-01', expiryDate: '' },
      { name: 'ITIL Foundation', issuingOrganization: 'Axelos', issueDate: '2018-01-01', expiryDate: '' }
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Okello/);
  });
});

describe('a modern resume', () => {
  const r = extractFieldsFromText(CV.MODERN);

  test('reads the contact line', () => {
    expect(r).toEqual(expect.objectContaining({
      fullName: 'Brian Ochieng Otim', email: 'brian.otim@outlook.com', phone: '+256 701 234 567',
      linkedinUrl: 'https://linkedin.com/in/brianotim', portfolioUrl: 'github.com/botim'
    }));
  });

  test('reads "Title | Employer | dates" and "Employer, place / Title / dates"', () => {
    expect(r.workExperience.map(({ jobTitle, employer, startDate, endDate }) => ({ jobTitle, employer, startDate, endDate }))).toEqual([
      { jobTitle: 'Senior Systems Engineer', employer: 'Uganda Civil Aviation Authority', startDate: '2019-01-01', endDate: '' },
      { jobTitle: 'IT Support Intern', employer: 'Stanbic Bank Uganda Ltd', startDate: '2017-06-01', endDate: '2017-12-01' }
    ]);
    expect(r.workExperience[0].duties).toHaveLength(2);
  });

  test('reads abbreviated degrees, their year and CGPA', () => {
    expect(r.education).toEqual([
      expect.objectContaining({ qualificationLevel: 'Masters', fieldOfStudy: 'Information Systems', institution: 'Uganda Martyrs University', yearCompleted: 2021 }),
      expect.objectContaining({ qualificationLevel: 'Bachelors', fieldOfStudy: 'Electrical Engineering', institution: 'Kyambogo University', yearCompleted: 2017, cgpa: '4.1' })
    ]);
  });

  test('reads issuers and expiry dates', () => {
    expect(r.certificates).toEqual([
      { name: 'CCNA', issuingOrganization: 'Cisco', issueDate: '2020-01-01', expiryDate: '' },
      { name: 'PMP', issuingOrganization: 'Project Management Institute', issueDate: '2022-01-01', expiryDate: '2025-01-01' }
    ]);
  });
});

describe('letter-spaced headings, dates first', () => {
  const r = extractFieldsFromText(CV.DATES_FIRST);

  test('keeps a sentence about the job out of the employer', () => {
    expect(r.workExperience[0]).toEqual({
      jobTitle: 'Accountant', employer: 'Ministry of Finance, Planning and Economic Development', startDate: '2015-01-01', endDate: '2018-01-01',
      duties: ['Prepared monthly financial statements for the ministry and reconciled bank accounts.']
    });
    expect(r.workExperience[1]).toEqual(expect.objectContaining({ jobTitle: 'Accounts Assistant', employer: 'Nile Breweries Limited' }));
  });

  test('reads qualifications over several lines', () => {
    expect(r.education).toEqual([
      expect.objectContaining({ qualificationLevel: 'Diploma', fieldOfStudy: 'Accounting', institution: 'Uganda College of Commerce Pakwach', yearCompleted: 2012 }),
      expect.objectContaining({ qualificationLevel: 'Certificate', fieldOfStudy: 'Computer Applications', institution: 'Kampala Institute of Business', yearCompleted: 2010 })
    ]);
  });

  test('says when only a year was given, and no year range is taken for a phone number', () => {
    expect(r.phone).toBe('');
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/only a year/)]));
  });
});

test('a CV with no headings is still read, with a warning', () => {
  const r = extractFieldsFromText(CV.NO_HEADINGS);
  expect(r.workExperience.map((w) => [w.jobTitle, w.employer, w.startDate, w.endDate])).toEqual([
    ['First Officer', 'Uganda Airlines', '2019-01-01', ''],
    ['Flight Dispatcher', 'Eagle Air Ltd', '2015-01-01', '2019-01-01']
  ]);
  expect(r.education).toEqual([expect.objectContaining({ qualificationLevel: 'Bachelors', fieldOfStudy: 'Aviation Management', institution: 'Kenya Aeronautical College' })]);
  expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/no headings/)]));
});

test('O-Level and A-Level results become exam grades', () => {
  const r = extractFieldsFromText(CV.RESULTS);
  expect(r.examGrades).toEqual(expect.arrayContaining([
    { level: 'OLevel', subject: 'Mathematics', grade: '1' },
    { level: 'OLevel', subject: 'English Language', grade: '3' },
    { level: 'OLevel', subject: 'Physics', grade: '2' },
    { level: 'ALevel', subject: 'History', grade: 'A' },
    { level: 'ALevel', subject: 'General Paper', grade: 'D' }
  ]));
  expect(r.examGrades).toHaveLength(8);
  expect(r.education).toEqual([expect.objectContaining({ qualificationLevel: 'Bachelors', fieldOfStudy: 'Laws', institution: 'Uganda Christian University' })]);
  expect(r.workExperience).toEqual([expect.objectContaining({ jobTitle: 'Legal Officer', employer: 'Kampala Capital City Authority (KCCA)', startDate: '2017-08-01' })]);
});

describe('a mixed layout', () => {
  const r = extractFieldsFromText(CV.MIXED);

  test('re-cases names written in capitals, keeping acronyms', () => {
    expect(r.fullName).toBe('Okello David');
    expect(r.workExperience[0]).toEqual(expect.objectContaining({ employer: 'Uganda Airlines', jobTitle: 'Cabin Crew Supervisor', startDate: '2018-03-01', endDate: '2021-06-01' }));
    expect(r.certificates[0]).toEqual(expect.objectContaining({ name: 'Certified Public Accountant (CPA)', issuingOrganization: 'ICPAU' }));
  });

  test('reads a job written as one table row', () => {
    expect(r.workExperience[1]).toEqual(expect.objectContaining({ employer: 'Uganda Clays Ltd', jobTitle: 'Sales Officer', startDate: '2014-01-01', endDate: '2018-01-01' }));
  });

  test('reads postgraduate and ordinary diplomas', () => {
    expect(r.education.map((e) => [e.qualificationLevel, e.fieldOfStudy, e.institution, e.yearCompleted])).toEqual([
      ['Bachelors', 'Business Administration', 'Makerere University Business School', 2019],
      ['Postgraduate', 'Project Planning and Management', 'Uganda Management Institute', 2020],
      ['Diploma', 'Tourism', 'Crested Crane Hotel and Tourism Training Institute', 2012]
    ]);
  });

  test('reads a licence with "Issued:" and "Expires:" cells', () => {
    expect(r.certificates[1]).toEqual({ name: 'Cabin Crew Licence', issuingOrganization: 'Civil Aviation Authority', issueDate: '2015-05-01', expiryDate: '2025-05-01' });
  });
});
