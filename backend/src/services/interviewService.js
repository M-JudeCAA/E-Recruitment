const crypto = require('crypto');
const panelMemberModel = require('../models/panelMemberModel');
const interviewModel = require('../models/interviewModel');
const { AppError } = require('../utils/errorResponse');

// Rubric limits - enough for any realistic panel scoresheet, small enough
// that a scoring form stays usable on a phone.
const MAX_CRITERIA = 12;
const MIN_RATING = 1;
const MAX_RATING = 5;
const CRITERION_ID_RE = /^c_[a-z0-9]{4,16}$/;

/**
 * Cleans a rubric as sent by the client into the stored shape
 * [{ id, name, weight, description }]. An existing, well-formed id is kept
 * (editing a rubric before anyone has scored) - otherwise one is generated,
 * so a stored criterionScores entry always points at a stable id. Returns
 * null for "no rubric" (the round is scored as one overall number).
 */
function normalizeCriteria(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) throw new AppError('criteria must be a list', 400);
  const cleaned = input
    .map((c) => ({
      id: typeof c?.id === 'string' && CRITERION_ID_RE.test(c.id) ? c.id : null,
      name: typeof c?.name === 'string' ? c.name.trim().slice(0, 120) : '',
      weight: Number(c?.weight ?? 1),
      description: typeof c?.description === 'string' && c.description.trim() ? c.description.trim().slice(0, 500) : null
    }))
    .filter((c) => c.name);
  if (cleaned.length === 0) return null;
  if (cleaned.length > MAX_CRITERIA) throw new AppError(`A rubric can have at most ${MAX_CRITERIA} criteria`, 400);
  const seen = new Set();
  for (const c of cleaned) {
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 10) {
      throw new AppError(`Weight for "${c.name}" must be a whole number from 1 to 10`, 400);
    }
    const key = c.name.toLowerCase();
    if (seen.has(key)) throw new AppError(`"${c.name}" appears twice in the rubric`, 400);
    seen.add(key);
    if (!c.id) c.id = `c_${crypto.randomBytes(4).toString('hex')}`;
  }
  return cleaned;
}

// Prisma returns a Json column already parsed; older/hand-edited rows may
// hold a string. Either way the caller gets an array or null.
function criteriaOf(round) {
  const raw = round?.criteria;
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
}

/**
 * Weighted rubric -> one 0-100 score. Each criterion is rated 1-5; a rating
 * is worth rating/5 of that criterion's weight, so all 5s is 100 and all 3s
 * is 60. Every criterion must be rated - a partial scoresheet would make
 * one panelist's number incomparable with another's.
 */
function scoreFromCriteria(criteria, criterionScores) {
  if (!criterionScores || typeof criterionScores !== 'object') {
    throw new AppError('Rate every criterion in the rubric', 400);
  }
  let weighted = 0;
  let totalWeight = 0;
  const cleaned = {};
  for (const c of criteria) {
    const rating = Number(criterionScores[c.id]);
    if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
      throw new AppError(`Rate "${c.name}" from ${MIN_RATING} to ${MAX_RATING}`, 400);
    }
    cleaned[c.id] = rating;
    weighted += c.weight * (rating / MAX_RATING);
    totalWeight += c.weight;
  }
  return { score: Math.round((weighted / totalWeight) * 1000) / 10, criterionScores: cleaned };
}

/**
 * Turns a submitted score (either { score } or { criterionScores }) into
 * what gets stored, according to whether the round has a rubric. Used by
 * both the HR proxy path and the panelist's own link.
 */
function resolveSubmittedScore(round, { score, criterionScores }) {
  const criteria = criteriaOf(round);
  if (criteria) return scoreFromCriteria(criteria, criterionScores);
  const numeric = Number(score);
  if (score === '' || score == null || !Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new AppError('score must be a number between 0 and 100', 400);
  }
  return { score: numeric, criterionScores: null };
}

/**
 * Records a score/comments for one panel member, on behalf of a panelist
 * who may have no system account at all - the coordinating HR Officer
 * (recordedById) is the one submitting this, not necessarily the panelist.
 * Then recomputes the round's overall score as the average of every
 * panel member scored so far.
 */
async function recordPanelScore(panelMemberId, { score, comments, criterionScores = null }, recordedById) {
  const panelMember = await panelMemberModel.update(panelMemberId, {
    score, criterionScores, comments, recordedById, selfSubmitted: false, submittedAt: new Date()
  });
  await recomputeRoundScore(panelMember.interviewRoundId);
  return panelMember;
}

// Recused panelists are left out - they stood down, so their score (if HR
// recorded one before the recusal) must not count.
async function recomputeRoundScore(interviewRoundId) {
  const members = await panelMemberModel.findByRound(interviewRoundId);
  const scored = members.filter((m) => m.score != null && !m.recusedAt);
  const average = scored.length
    ? Math.round((scored.reduce((sum, m) => sum + m.score, 0) / scored.length) * 10) / 10
    : null;
  await interviewModel.update(interviewRoundId, { score: average });
  return average;
}

// Used by the public token-submit path, which only has a panelMemberId on
// hand (the record was already re-fetched by that point) rather than the
// interviewRoundId directly.
async function recomputeRoundScoreFor(panelMemberId) {
  const panelMember = await panelMemberModel.findById(panelMemberId);
  return recomputeRoundScore(panelMember.interviewRoundId);
}

/**
 * Where a round's panel stands: how many active (non-recused) panelists,
 * how many have scored, whether that's everyone, and the spread between
 * the highest and lowest score - a wide spread means the panel disagreed
 * and is worth a conversation before finalizing.
 */
function panelProgress(members = []) {
  const active = members.filter((m) => !m.recusedAt);
  const scores = active.filter((m) => m.score != null).map((m) => m.score);
  return {
    total: active.length,
    scored: scores.length,
    complete: active.length > 0 && scores.length === active.length,
    spread: scores.length > 1 ? Math.round((Math.max(...scores) - Math.min(...scores)) * 10) / 10 : null
  };
}

// A spread at or above this many points is flagged as "panel disagreement".
const HIGH_SPREAD = 25;

/**
 * Per-criterion averages across a round's active scored panelists - the
 * Scorecards comparison reads these to show where a candidate was strong
 * or weak, not just the overall number.
 */
function criterionAverages(round, members = []) {
  const criteria = criteriaOf(round);
  if (!criteria) return null;
  const active = members.filter((m) => !m.recusedAt && m.criterionScores);
  return criteria.map((c) => {
    const ratings = active
      .map((m) => Number((typeof m.criterionScores === 'string' ? JSON.parse(m.criterionScores) : m.criterionScores)[c.id]))
      .filter((n) => Number.isFinite(n));
    return {
      id: c.id, name: c.name, weight: c.weight,
      average: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null
    };
  });
}

module.exports = {
  MAX_CRITERIA, MIN_RATING, MAX_RATING, HIGH_SPREAD,
  normalizeCriteria, criteriaOf, scoreFromCriteria, resolveSubmittedScore,
  recordPanelScore, recomputeRoundScore, recomputeRoundScoreFor, panelProgress, criterionAverages
};
