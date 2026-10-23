// CV texts in the layouts candidates actually send, as cvParser.extractText
// gives them (tables as "cell | cell", blank lines between blocks). Used by
// cvHeuristics.test.js.

// A Ugandan-style CV: bio data with labels, a qualifications table, an
// employment record with "Position:/Organisation:/Period:" labels.
const LABELLED = `CURRICULUM VITAE

NAKATO SARAH MIREMBE

PERSONAL DETAILS
Date of Birth: 12th March 1990
Nationality: Ugandan
NIN: CF90012345678A
District of Origin: Mukono
Place of Residence: Ntinda, Kampala
Telephone: 0772 123456
Email: sarah.nakato@gmail.com

ACADEMIC QUALIFICATIONS
Year | Institution | Award
2009 - 2012 | Makerere University | Bachelor of Science in Computer Science (Second Class Upper)
2007 - 2008 | St. Mary's College Kisubi | Uganda Advanced Certificate of Education (UACE)
2003 - 2006 | Gayaza High School | Uganda Certificate of Education (UCE)

EMPLOYMENT RECORD
Position: Systems Administrator
Organisation: Uganda Revenue Authority
Period: March 2016 to date
Duties and Responsibilities:
• Administering the authority's Windows and Linux servers
• Managing backups and disaster recovery
• Supervising two junior officers

Position: IT Officer
Organisation: Mukono District Local Government
Period: Jan 2013 - Feb 2016
Duties:
• Maintaining the district's network
• Training staff on new systems

TRAININGS ATTENDED
• Cisco Certified Network Associate (CCNA) - Cisco Networking Academy, 2014
• ITIL Foundation, Axelos, 2018

REFEREES
Mr. John Okello
IT Manager, Uganda Revenue Authority
0701 000000
`;

// A modern resume: contacts on one line, "Title | Employer | dates" and
// "Employer, place" / "Title" / "dates" blocks, bullets, skills.
const MODERN = `Brian Ochieng Otim
Aviation Systems Engineer
brian.otim@outlook.com | +256 701 234 567 | linkedin.com/in/brianotim | github.com/botim

PROFESSIONAL EXPERIENCE

Senior Systems Engineer | Uganda Civil Aviation Authority | Jan 2019 - Present
- Lead the maintenance of air navigation systems at Entebbe International Airport
- Introduced preventive maintenance schedules, cutting downtime by 30%

Stanbic Bank Uganda Ltd, Kampala
IT Support Intern
Jun 2017 - Dec 2017
- Resolved user tickets for 300 staff
- Set up branch workstations

EDUCATION
MSc Information Systems - Uganda Martyrs University, 2021
BSc. Electrical Engineering, Kyambogo University (2013 - 2017), CGPA 4.1

CERTIFICATIONS
CCNA - Cisco (2020)
PMP, Project Management Institute, 2022, expires 2025

SKILLS
Networking, Linux, Python
`;

// Letter-spaced headings, dates first, title then employer on their own lines.
const DATES_FIRST = `JANE AUMA

E X P E R I E N C E

2015 - 2018
Accountant
Ministry of Finance, Planning and Economic Development
Prepared monthly financial statements for the ministry
and reconciled bank accounts.

2012 - 2015
Accounts Assistant
Nile Breweries Limited
• Posted ledger entries

E D U C A T I O N

Diploma in Accounting
Uganda College of Commerce Pakwach
2012

Certificate in Computer Applications, Kampala Institute of Business, 2010

L A N G U A G E S
English, Luganda
`;

// No headings at all.
const NO_HEADINGS = `Peter Mugisha
First Officer at Uganda Airlines, 2019 - Present
Flight Dispatcher at Eagle Air Ltd, 2015 - 2019
Bachelor of Science in Aviation Management, Kenya Aeronautical College, 2014
`;

// O-Level and A-Level results under their own headings.
const RESULTS = `EDUCATION
Bachelor of Laws (LLB), Uganda Christian University, 2016

A-LEVEL RESULTS (UACE 2011)
History - A
Economics - B
Literature in English - C
General Paper - D

O-LEVEL RESULTS (UCE 2009)
Mathematics D1
English Language C3
Physics 2
Biology C4

WORK EXPERIENCE
Legal Officer, Kampala Capital City Authority (KCCA)
August 2017 - Present
`;

// Employer in capitals over "Title | dates", a one-line table row, dates
// before a qualification, licences with issue and expiry dates.
const MIXED = `OKELLO DAVID
Kampala, Uganda • okello.d@yahoo.com • 0752-987654

CAREER SUMMARY
Experienced cabin crew professional with ten years in commercial aviation.

WORK HISTORY
UGANDA AIRLINES | Entebbe
Cabin Crew Supervisor | March 2018 - June 2021
• Led a team of 8 cabin crew on regional routes
• Conducted pre-flight safety briefings

2014 - 2018 | Uganda Clays Ltd | Sales Officer

EDUCATIONAL BACKGROUND
2016 - 2019: Bachelor of Business Administration, Makerere University Business School
Postgraduate Diploma in Project Planning and Management - Uganda Management Institute (2020)
Ordinary Diploma in Tourism, Crested Crane Hotel and Tourism Training Institute, 2012

PROFESSIONAL QUALIFICATIONS
Certified Public Accountant (CPA), ICPAU - 2017
Cabin Crew Licence | Civil Aviation Authority | Issued: 05/2015 | Expires: 05/2025

REFERENCES
Available on request
`;

module.exports = { LABELLED, MODERN, DATES_FIRST, NO_HEADINGS, RESULTS, MIXED };
