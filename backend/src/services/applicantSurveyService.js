const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');

// The short survey internal candidates are offered right after submitting an
// application - how applying through the system went, for the pilot review.
// One per application and skippable. HR and system administrators read the
// answers without the candidate's name (feedbackController).

const RATINGS = ['overallRating', 'easeRating', 'clarityRating'];
const TIME_TAKEN = {
  under15: 'Under 15 minutes',
  '15to30': '15 to 30 minutes',
  '30to60': '30 minutes to an hour',
  over60: 'More than an hour'
};
const MAX_TEXT = 2000;

function surveyError(message, code, status = 400) {
  const err = new AppError(message, status);
  err.code = code;
  return err;
}

function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_TEXT);
  return trimmed || null;
}

// The answers as stored, or a 400 naming what is wrong.
function parseAnswers(body = {}) {
  const answers = {};
  for (const key of RATINGS) {
    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw surveyError('Please answer each rating question with 1 to 5 stars', 'SURVEY_INCOMPLETE');
    }
    answers[key] = value;
  }
  if (body.timeTaken != null && body.timeTaken !== '' && !TIME_TAKEN[body.timeTaken]) {
    throw surveyError('Choose how long applying took from the list', 'SURVEY_INCOMPLETE');
  }
  answers.timeTaken = TIME_TAKEN[body.timeTaken] ? body.timeTaken : null;
  answers.hadProblems = body.hadProblems === true;
  answers.problems = answers.hadProblems ? text(body.problems) : null;
  answers.suggestions = text(body.suggestions);
  return answers;
}

// The candidate's own submitted application - the survey is about applying,
// so a draft (or someone else's application) is refused.
async function applicationFor(candidateId, applicationId) {
  const id = Number(applicationId);
  if (!Number.isInteger(id)) throw surveyError('No such application', 'APPLICATION_NOT_FOUND', 404);
  const application = await prisma.application.findFirst({
    where: { id, candidateId },
    select: { id: true, status: true, vacancy: { select: { title: true, jobRef: true } } }
  });
  if (!application || application.status === 'Draft') throw surveyError('No such application', 'APPLICATION_NOT_FOUND', 404);
  return application;
}

async function status(candidateId, applicationId) {
  await applicationFor(candidateId, applicationId);
  const existing = await prisma.applicantSurvey.findUnique({ where: { applicationId: Number(applicationId) }, select: { submittedAt: true } });
  return { answered: Boolean(existing), submittedAt: existing?.submittedAt || null };
}

async function submit(candidateId, body = {}) {
  const application = await applicationFor(candidateId, body.applicationId);
  const answers = parseAnswers(body);
  try {
    return await prisma.applicantSurvey.create({
      data: {
        candidateId,
        applicationId: application.id,
        vacancyTitle: application.vacancy?.title || '',
        jobRef: application.vacancy?.jobRef || null,
        ...answers
      },
      select: { id: true, submittedAt: true }
    });
  } catch (err) {
    if (err.code === 'P2002') throw surveyError('You have already given feedback on this application - thank you', 'SURVEY_ALREADY_ANSWERED', 409);
    throw err;
  }
}

function dayStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function whereFrom(query = {}) {
  const from = dayStart(query.from);
  const to = dayStart(query.to);
  if (to) to.setUTCDate(to.getUTCDate() + 1);
  return from || to ? { submittedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {};
}

// What staff see of a response: no candidate id or name.
function toStaffView(row) {
  return {
    id: row.id,
    submittedAt: row.submittedAt,
    vacancyTitle: row.vacancyTitle,
    jobRef: row.jobRef,
    overallRating: row.overallRating,
    easeRating: row.easeRating,
    clarityRating: row.clarityRating,
    timeTaken: row.timeTaken,
    timeTakenLabel: TIME_TAKEN[row.timeTaken] || null,
    hadProblems: row.hadProblems,
    problems: row.problems,
    suggestions: row.suggestions
  };
}

function average(rows, key) {
  if (rows.length === 0) return null;
  return Math.round((rows.reduce((sum, r) => sum + r[key], 0) / rows.length) * 10) / 10;
}

function summarise(rows) {
  const distribution = (key) => [1, 2, 3, 4, 5].map((n) => rows.filter((r) => r[key] === n).length);
  return {
    responses: rows.length,
    averages: Object.fromEntries(RATINGS.map((key) => [key, average(rows, key)])),
    distribution: Object.fromEntries(RATINGS.map((key) => [key, distribution(key)])),
    hadProblems: rows.filter((r) => r.hadProblems).length,
    timeTaken: Object.entries(TIME_TAKEN).map(([key, label]) => ({ key, label, count: rows.filter((r) => r.timeTaken === key).length }))
  };
}

async function list(query = {}) {
  const rows = await prisma.applicantSurvey.findMany({ where: whereFrom(query), orderBy: { submittedAt: 'desc' } });
  const responses = rows.map(toStaffView);
  return { summary: summarise(responses), responses };
}

module.exports = { RATINGS, TIME_TAKEN, parseAnswers, status, submit, list, summarise, toStaffView };
