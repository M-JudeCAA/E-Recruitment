const prisma = require('../config/db');
const templates = require('./templateService');
const { describeSalary } = require('./offerService');
const { escapeHtml } = require('../utils/interviewFormat');
const { computeExperienceYears, highestEducationLevel } = require('./screeningService');
const { AppError } = require('../utils/errorResponse');

// The printed documents: each loads its record, builds the placeholder
// values its template offers (config/documentTemplates.js), and renders it.
// Returns { title, html, vacancyId, applicationId, candidateIds } - the ids
// for the access log.

const TZ = () => process.env.APP_TIMEZONE || 'Africa/Kampala';
const SIGNATORY = 'Director Human Resource & Administration';
const EMPLOYMENT = { FullTime: 'permanent and pensionable', Contract: 'on contract', FixedTermContract: 'on a fixed-term contract' };
const EDUCATION = { PhD: 'PhD', Masters: "Master's", Postgraduate: 'Postgraduate', Bachelors: "Bachelor's", Diploma: 'Diploma', Certificate: 'Certificate', ALevel: 'A Level', OLevel: 'O Level' };

const longDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ() }) : '');
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ() }) : '');

function base(vacancy, candidate) {
  return {
    date: longDate(new Date()),
    candidateName: candidate?.fullName,
    candidateAddress: candidate?.location,
    jobTitle: vacancy.title,
    jobRef: vacancy.jobRef,
    department: vacancy.department?.name,
    signatoryTitle: SIGNATORY
  };
}

function list(items) {
  const rows = (items || []).map((c) => String(c).trim()).filter(Boolean);
  return rows.length ? `<ul>${rows.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : '<p>None.</p>';
}

function offerContext(offer) {
  const { vacancy, candidate } = offer.application;
  return {
    ...base(vacancy, candidate),
    salary: describeSalary(offer),
    allowances: offer.allowances || 'none',
    employmentType: EMPLOYMENT[offer.employmentCategory] || '',
    contractTerm: offer.contractMonths ? `for ${offer.contractMonths} months` : '',
    startDate: longDate(offer.startDate),
    dutyStation: offer.dutyStation || vacancy.location,
    responseDeadline: longDate(offer.responseDeadline),
    acceptedDate: longDate(offer.decidedAt),
    conditionsList: list(Array.isArray(offer.conditions) ? offer.conditions : [])
  };
}

const APPLICATION_INCLUDE = { candidate: true, vacancy: { include: { department: true } } };

async function loadOffer(offerId) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { application: { include: APPLICATION_INCLUDE } } });
  if (!offer) throw new AppError('Offer not found', 404);
  if (offer.salaryAmount == null) throw new AppError('This offer has no terms recorded, so no letter can be made from it', 422);
  return offer;
}

function ids(application) {
  return { vacancyId: application.vacancyId, applicationId: application.id, candidateIds: [application.candidateId] };
}

async function offerLetter(offerId) {
  const offer = await loadOffer(offerId);
  const { title } = offer.application.vacancy;
  return {
    ...(await templates.render('offerLetter', offerContext(offer), `Offer of employment - ${offer.application.candidate.fullName} - ${title}`)),
    ...ids(offer.application)
  };
}

async function appointmentInstrument(offerId) {
  const offer = await loadOffer(offerId);
  if (offer.status !== 'Accepted') throw new AppError('The appointing instrument is made once the candidate has accepted the offer', 422);
  return {
    ...(await templates.render('appointmentInstrument', offerContext(offer), `Appointment - ${offer.application.candidate.fullName} - ${offer.application.vacancy.title}`)),
    ...ids(offer.application)
  };
}

async function interviewInvitation(interviewId) {
  const round = await prisma.interviewRound.findUnique({ where: { id: interviewId }, include: { application: { include: APPLICATION_INCLUDE } } });
  if (!round) throw new AppError('Interview not found', 404);
  if (!round.scheduledDate) throw new AppError('This interview has no date yet', 422);
  const venue = round.mode === 'Virtual' ? `online${round.meetingLink ? ` (${round.meetingLink})` : ''}`
    : round.mode === 'Phone' ? 'by phone - we will call you' : (round.location || 'the venue we will confirm');
  const { vacancy, candidate } = round.application;
  return {
    ...(await templates.render('interviewInvitation', {
      ...base(vacancy, candidate),
      interviewDate: longDate(round.scheduledDate), interviewTime: time(round.scheduledDate), venue,
      instructions: round.instructions || ''
    }, `Interview invitation - ${candidate.fullName} - ${vacancy.title}`)),
    ...ids(round.application)
  };
}

async function regretLetter(applicationId) {
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: APPLICATION_INCLUDE });
  if (!application) throw new AppError('Application not found', 404);
  if (application.status !== 'Rejected') throw new AppError('A regret letter is only for an application that was not successful', 422);
  return {
    ...(await templates.render('regretLetter', base(application.vacancy, application.candidate), `Regret letter - ${application.candidate.fullName} - ${application.vacancy.title}`)),
    ...ids(application)
  };
}

// The approved interview shortlist still waiting for EXCO (see
// excoShortlistController) - or, once none is waiting, everyone EXCO approved.
async function excoShortlist(vacancyId) {
  const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId }, include: { department: true } });
  if (!vacancy) throw new AppError('Vacancy not found', 404);
  const select = {
    id: true, rank: true, candidateId: true, committeeRank: true, committeeScore: true,
    candidate: { select: { fullName: true, candidateType: true, education: { select: { qualificationLevel: true } }, workExperience: { select: { startDate: true, endDate: true } } } }
  };
  let rows = await prisma.application.findMany({
    where: { vacancyId, status: 'Shortlisted', excoApprovalId: null, interviewRounds: { none: {} } }, select, orderBy: [{ rank: 'asc' }, { id: 'asc' }]
  });
  if (rows.length === 0) {
    rows = await prisma.application.findMany({ where: { vacancyId, excoApprovalId: { not: null } }, select, orderBy: [{ rank: 'asc' }, { id: 'asc' }] });
  }
  if (rows.length === 0) throw new AppError('There is no approved interview shortlist for this vacancy yet', 422);
  const table = '<table><thead><tr><th>#</th><th>Candidate</th><th>Type</th><th>Highest qualification</th><th>Experience (years)</th><th>Committee rank</th><th>EXCO remarks</th></tr></thead><tbody>'
    + rows.map((a, i) => {
      const level = highestEducationLevel(a.candidate.education);
      return `<tr><td>${i + 1}</td><td>${escapeHtml(a.candidate.fullName)}</td><td>${escapeHtml(a.candidate.candidateType)}</td>`
        + `<td>${escapeHtml(EDUCATION[level] || level || '-')}</td><td>${Math.round(computeExperienceYears(a.candidate.workExperience) * 10) / 10}</td>`
        + `<td>${a.committeeRank ? `#${a.committeeRank}${a.committeeScore != null ? ` (${a.committeeScore})` : ''}` : '-'}</td><td>&nbsp;</td></tr>`;
    }).join('')
    + '</tbody></table>';
  return {
    ...(await templates.render('excoShortlist', {
      date: longDate(new Date()), jobTitle: vacancy.title, jobRef: vacancy.jobRef, department: vacancy.department?.name,
      positionsRequired: vacancy.positionsRequired, dutyStation: vacancy.location, salaryScale: vacancy.salaryScale, shortlistTable: table
    }, `Interview shortlist for EXCO - ${vacancy.jobRef}`)),
    vacancyId, applicationId: null, candidateIds: rows.map((a) => a.candidateId)
  };
}

// Made-up values for previewing a template while it's being edited.
const SAMPLE = {
  date: longDate(new Date()), candidateName: 'Jane Achieng', candidateAddress: 'Entebbe, Uganda', jobTitle: 'Air Traffic Control Officer',
  jobRef: 'UCAA/ADV/EXT/001/2026', department: 'Air Traffic Management', signatoryTitle: SIGNATORY,
  salary: 'UGX 4,500,000 per month', allowances: 'Transport allowance UGX 300,000 per month', employmentType: 'permanent and pensionable',
  contractTerm: '', startDate: longDate(Date.now() + 30 * 86400000), dutyStation: 'Entebbe International Airport',
  responseDeadline: longDate(Date.now() + 14 * 86400000), acceptedDate: longDate(new Date()),
  conditionsList: list(['Satisfactory reference checks', 'A certificate of medical fitness']),
  interviewDate: longDate(Date.now() + 7 * 86400000), interviewTime: '10:00', venue: 'Board Room, UCAA Head Office',
  instructions: 'Please bring your National ID and the originals of your certificates.', positionsRequired: 2, salaryScale: 'U5',
  shortlistTable: '<table><thead><tr><th>#</th><th>Candidate</th></tr></thead><tbody><tr><td>1</td><td>Jane Achieng</td></tr></tbody></table>'
};

function preview(key, body) {
  return { title: templates.DEFAULTS[key]?.name, html: templates.fill(key, body, SAMPLE), unknown: templates.unknownPlaceholders(key, body) };
}

module.exports = { offerLetter, appointmentInstrument, interviewInvitation, regretLetter, excoShortlist, preview };
