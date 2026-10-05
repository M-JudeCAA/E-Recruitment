const crypto = require('crypto');
const { AppError } = require('../utils/errorResponse');

// The shortlisting committee's rules - pure functions, no database.
//
// A committee (never HR staff) rates every screened applicant on the
// vacancy's criteria: Essential ones Met / Partly met / Not met, Desirable
// ones 1-5. Each applicant is placed in a band by how the raters agree on the
// essential criteria, then ranked:
//
//   1. band: Unanimous (every rater: every essential met) > Majority (every
//      essential met by a majority, or by the chair's ruling) > Disputed (an
//      essential with no clear majority - the chair must rule before the
//      exercise can close) > NotQualified (a majority, or the chair, found an
//      essential not met);
//   2. weighted consensus score (0-100) across all criteria - desirable
//      criteria are what separate equally qualified applicants;
//   3. agreement (0-1) - a united committee's 80 ranks above a split 80;
//   4. years of experience.
//
// Applicants equal on all four share a rank, and the interview shortlist
// takes everyone tied at the cut line, so nobody is dropped by chance.
// Only ratings of members who have submitted count, and an applicant needs
// at least MIN_RATERS of them for the committee's view to stand - with fewer
// (conflicts, or members who never submitted) every essential criterion goes
// to the chair, rather than one person deciding alone.

const NOT_MET = 0;
const PARTLY = 1;
const MET = 2;
const ESSENTIAL_LABELS = { [NOT_MET]: 'Not met', [PARTLY]: 'Partly met', [MET]: 'Met' };
const BAND_ORDER = { Unanimous: 1, Majority: 2, Disputed: 3, NotQualified: 4 };
const QUALIFIED_BANDS = ['Unanimous', 'Majority'];
const MAX_CRITERIA = 40;
const MIN_MEMBERS = 3;
const MIN_RATERS = 2;

const EDUCATION_LABELS = {
  OLevel: 'O-Level', ALevel: 'A-Level', Certificate: 'Certificate', Diploma: 'Diploma', Bachelors: "Bachelor's degree",
  Postgraduate: 'Postgraduate diploma', Masters: "Master's degree", PhD: 'PhD'
};

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * The assessment sheet a new exercise starts from, built from the vacancy's
 * own person specification. autoKey links a criterion to the matching
 * automated check (screeningService.evaluateEssentialCriteria), shown to
 * raters as a reference; question links a desirable criterion to the
 * candidate's answer to that desirable question.
 */
function defaultCriteria(vacancy) {
  const list = [];
  const add = (kind, label, extra = {}) => list.push({ id: newId(), kind, label, weight: 1, ...extra });

  if (vacancy.minimumEducationLevel) {
    add('Essential', `Minimum qualification: ${EDUCATION_LABELS[vacancy.minimumEducationLevel] || vacancy.minimumEducationLevel}`
      + `${vacancy.preferredFieldOfStudy ? ` (relevant field, e.g. ${vacancy.preferredFieldOfStudy})` : ''}`, { autoKey: 'education' });
  }
  if (vacancy.minimumExperienceYears) {
    add('Essential', `At least ${vacancy.minimumExperienceYears} year(s) of relevant experience`, { autoKey: 'experience' });
  }
  if (vacancy.minimumAge || vacancy.maximumAge) {
    const bounds = [vacancy.minimumAge ? `at least ${vacancy.minimumAge}` : null, vacancy.maximumAge ? `at most ${vacancy.maximumAge}` : null];
    add('Essential', `Age ${bounds.filter(Boolean).join(' and ')}`, { autoKey: 'age' });
  }
  if (vacancy.minimumFlyingHours) add('Essential', `At least ${vacancy.minimumFlyingHours} flying hours`, { autoKey: 'flyingHours' });
  if (vacancy.minimumCGPA) add('Essential', `CGPA of at least ${vacancy.minimumCGPA}`, { autoKey: 'cgpa' });
  for (const g of asList(vacancy.requiredExamGrades)) {
    add('Essential', `${g.level === 'OLevel' ? 'O-Level' : 'A-Level'} ${g.subject}: ${g.minGrade} or better`, { autoKey: `examGrade-${g.id}` });
  }
  for (const text of asList(vacancy.essentialRequirements)) {
    if (typeof text === 'string' && text.trim()) add('Essential', text.trim());
  }
  for (const q of asList(vacancy.desirableRequirements)) {
    if (q?.text?.trim()) add('Desirable', q.text.trim(), { question: q.id });
  }
  if (vacancy.preferredFieldOfStudy && !vacancy.minimumEducationLevel) {
    add('Desirable', `Qualification in ${vacancy.preferredFieldOfStudy}`);
  }
  for (const text of [...asList(vacancy.specialSkills), ...asList(vacancy.generalKnowledge)]) {
    if (typeof text === 'string' && text.trim()) add('Desirable', text.trim());
  }
  return list;
}

/**
 * Validates HR's edited sheet. Keeps each existing criterion's id (and its
 * link to an automated check or question), generates ids for new ones.
 */
function normalizeCriteria(input) {
  if (!Array.isArray(input) || input.length === 0) throw new AppError('Add at least one criterion', 400);
  if (input.length > MAX_CRITERIA) throw new AppError(`At most ${MAX_CRITERIA} criteria`, 400);
  const seen = new Set();
  const list = input.map((c, i) => {
    const kind = c?.kind;
    if (!['Essential', 'Desirable'].includes(kind)) throw new AppError(`Criterion ${i + 1}: choose Essential or Desirable`, 400);
    const label = typeof c.label === 'string' ? c.label.trim() : '';
    if (label.length < 3 || label.length > 300) throw new AppError(`Criterion ${i + 1}: describe it in 3 to 300 characters`, 400);
    const weight = c.weight == null || c.weight === '' ? 1 : Number(c.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 5) throw new AppError(`Criterion ${i + 1}: weight must be a whole number from 1 to 5`, 400);
    let id = typeof c.id === 'string' && /^[a-z0-9]{6,24}$/i.test(c.id) ? c.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const row = { id, kind, label, weight };
    if (typeof c.autoKey === 'string') row.autoKey = c.autoKey;
    if (typeof c.question === 'string') row.question = c.question;
    return row;
  });
  if (!list.some((c) => c.kind === 'Essential')) throw new AppError('Add at least one Essential criterion', 400);
  return list;
}

// Checks one rating value against its criterion's scale.
function validRating(criterion, value) {
  if (!Number.isInteger(value)) return false;
  return criterion.kind === 'Essential' ? value >= NOT_MET && value <= MET : value >= 1 && value <= 5;
}

/**
 * Who rates whom. Every member rates the calibration set (the first
 * calibrationCount applicants) so their standards can be compared; each
 * remaining applicant goes to ratersPerApplicant members, always the ones
 * with the lightest load so far. With no more members than raters needed,
 * everyone rates everyone.
 *
 * Returns [{ memberId, applicationId, calibration }].
 */
function planAssignments(applicationIds, memberIds, { ratersPerApplicant = 3, calibrationCount = 10 } = {}) {
  const raters = Math.min(Math.max(ratersPerApplicant, 1), memberIds.length);
  const everyoneRatesAll = raters >= memberIds.length;
  const calibration = everyoneRatesAll ? applicationIds.length : Math.min(Math.max(calibrationCount, 0), applicationIds.length);
  const load = new Map(memberIds.map((id) => [id, 0]));
  const plan = [];

  applicationIds.forEach((applicationId, i) => {
    if (i < calibration) {
      for (const memberId of memberIds) {
        plan.push({ memberId, applicationId, calibration: !everyoneRatesAll });
        load.set(memberId, load.get(memberId) + 1);
      }
      return;
    }
    // Lightest load first; ties broken by rotating the starting member so
    // the same people don't always pair up.
    const chosen = memberIds
      .map((memberId, idx) => ({ memberId, load: load.get(memberId), order: (idx - i + memberIds.length * 1000) % memberIds.length }))
      .sort((a, b) => a.load - b.load || a.order - b.order)
      .slice(0, raters);
    for (const { memberId } of chosen) {
      plan.push({ memberId, applicationId, calibration: false });
      load.set(memberId, load.get(memberId) + 1);
    }
  });
  return plan;
}

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;

/**
 * One applicant's result on one criterion. ratings: the counted raters'
 * values; decision: the chair's ruling, if any.
 */
function criterionResult(criterion, ratings, decision, { raterCount = ratings.length } = {}) {
  const n = ratings.length;
  if (criterion.kind === 'Desirable') {
    return {
      id: criterion.id, kind: 'Desirable', raters: n,
      consensus: n ? mean(ratings.map((v) => (v - 1) / 4)) : 0,
      agreement: n ? 1 - (Math.max(...ratings) - Math.min(...ratings)) / 4 : null,
      average: n ? round(mean(ratings), 2) : null
    };
  }
  const counts = { met: 0, partly: 0, notMet: 0 };
  ratings.forEach((v) => { if (v === MET) counts.met += 1; else if (v === PARTLY) counts.partly += 1; else counts.notMet += 1; });
  let outcome;
  const tooFewRaters = raterCount < MIN_RATERS;
  if (decision) outcome = decision.outcome;
  else if (tooFewRaters) outcome = 'Disputed';
  else if (n > 0 && counts.met > n / 2) outcome = 'Met';
  else if (n > 0 && counts.notMet > n / 2) outcome = 'NotMet';
  else outcome = 'Disputed';
  return {
    id: criterion.id, kind: 'Essential', raters: n, counts, outcome,
    unanimous: !decision && !tooFewRaters && n > 0 && counts.met === n,
    tooFewRaters,
    decidedByChair: Boolean(decision),
    consensus: n ? mean(ratings.map((v) => v / 2)) : 0,
    agreement: n ? Math.max(counts.met, counts.partly, counts.notMet) / n : null
  };
}

/**
 * Ranks the pool.
 *
 * applicants: [{ applicationId, experienceYears, ratings: [{ memberSubmitted,
 *   conflict, values: { [criterionId]: number } }] }] - one ratings entry per
 *   assignment.
 * decisions: [{ applicationId, criterionId, outcome }]
 *
 * Returns rows sorted by rank: { applicationId, band, score, agreement,
 * experienceYears, rank, raterCount, criteria: [...criterionResult],
 * disputed: [criterionId] }.
 */
function computeResults(criteria, applicants, decisions = []) {
  const decisionOf = new Map(decisions.map((d) => [`${d.applicationId}|${d.criterionId}`, d]));
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;

  const rows = applicants.map((a) => {
    const counted = a.ratings.filter((r) => r.memberSubmitted && !r.conflict);
    const results = criteria.map((c) => criterionResult(
      c,
      counted.map((r) => r.values[c.id]).filter((v) => Number.isInteger(v)),
      decisionOf.get(`${a.applicationId}|${c.id}`),
      { raterCount: counted.length }
    ));
    const essentials = results.filter((r) => r.kind === 'Essential');
    let band;
    if (essentials.some((r) => r.outcome === 'NotMet')) band = 'NotQualified';
    else if (essentials.some((r) => r.outcome === 'Disputed')) band = 'Disputed';
    else if (essentials.every((r) => r.unanimous)) band = 'Unanimous';
    else band = 'Majority';

    const score = 100 * criteria.reduce((s, c, i) => s + c.weight * results[i].consensus, 0) / totalWeight;
    const agreements = results.map((r) => r.agreement).filter((v) => v != null);
    return {
      applicationId: a.applicationId,
      band,
      score: round(score, 1),
      agreement: agreements.length ? round(mean(agreements), 2) : 0,
      experienceYears: round(a.experienceYears || 0, 1),
      raterCount: counted.length,
      criteria: results,
      disputed: essentials.filter((r) => r.outcome === 'Disputed').map((r) => r.id)
    };
  });

  const key = (r) => [BAND_ORDER[r.band], -r.score, -r.agreement, -r.experienceYears];
  const compare = (x, y) => {
    const a = key(x); const b = key(y);
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  rows.sort((x, y) => compare(x, y) || x.applicationId - y.applicationId);
  // Competition ranking: 1, 2, 2, 4 - ties share a rank.
  rows.forEach((r, i) => { r.rank = i > 0 && compare(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}

/**
 * The interview shortlist from the committee's order: the top `count`
 * qualified applicants, plus anyone tied with the last of them. rows need
 * { applicationId, band, rank }. Returns application ids in rank order.
 */
function shortlistFromResults(rows, count, positionsRequired = 1) {
  const qualified = rows.filter((r) => QUALIFIED_BANDS.includes(r.band)).sort((a, b) => a.rank - b.rank);
  if (qualified.length === 0) throw new AppError('The committee found no applicant qualified', 422);
  const minimum = Math.min(positionsRequired, qualified.length);
  if (!Number.isInteger(count) || count < minimum) {
    throw new AppError(`Interview at least ${minimum} candidate(s) - the number of posts, or every qualified applicant if there are fewer`, 400);
  }
  if (count > qualified.length) throw new AppError(`Only ${qualified.length} applicant(s) were found qualified`, 400);
  const cutRank = qualified[count - 1].rank;
  return qualified.filter((r) => r.rank <= cutRank).map((r) => r.applicationId);
}

module.exports = {
  NOT_MET, PARTLY, MET, ESSENTIAL_LABELS, BAND_ORDER, QUALIFIED_BANDS, MIN_MEMBERS, MIN_RATERS,
  defaultCriteria, normalizeCriteria, validRating, planAssignments, criterionResult, computeResults, shortlistFromResults
};
