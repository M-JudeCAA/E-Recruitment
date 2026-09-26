const crypto = require('crypto');
const panelAccessTokenModel = require('../models/panelAccessTokenModel');
const { sendMail } = require('../utils/mailer');
const { frontendUrl } = require('../config/frontendUrl');
const { AppError } = require('../utils/errorResponse');
const { formatWhen, escapeHtml } = require('../utils/interviewFormat');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days - interviews are often scheduled ahead

async function createAccessToken(panelMemberId) {
  const token = crypto.randomBytes(32).toString('hex');
  await panelAccessTokenModel.create({
    token,
    panelMemberId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
  });
  return token;
}

/**
 * Read-only check for the scoring page itself - does not consume the
 * token, since a panelist may load the page, step away, and come back
 * before submitting. Errors are AppErrors (410 Gone) so the message the
 * panelist sees is the specific reason, not a generic failure.
 */
async function validateForView(token) {
  const record = await panelAccessTokenModel.findByToken(token);
  if (!record) throw new AppError('Invalid access link', 410);
  if (record.usedAt) throw new AppError('This scoring link has already been used', 410);
  if (record.expiresAt < new Date()) throw new AppError('This scoring link has expired', 410);
  if (record.panelMember.score != null) throw new AppError('A score has already been recorded for this panelist', 410);
  if (record.panelMember.recusedAt) throw new AppError('You have stood down from this interview panel', 410);
  const status = record.panelMember.interviewRound?.status;
  if (status && status !== 'Scheduled') {
    throw new AppError(status === 'Completed'
      ? 'The panel\'s recommendation for this interview has already been finalized'
      : 'This interview did not go ahead, so no score is needed', 410);
  }
  return record;
}

/**
 * Consumes the token at submission time - single-use, so a panelist
 * can't revise a score after the fact without HR issuing a new link.
 */
async function consumeForSubmit(token) {
  const record = await validateForView(token);
  await panelAccessTokenModel.markUsed(record.id);
  return record;
}

async function revokeOutstandingTokens(panelMemberId) {
  await panelAccessTokenModel.markAllUsedForPanelMember(panelMemberId);
}

/**
 * Issues a fresh single-use link for one panelist, revoking any earlier one
 * first so two valid links never coexist, and emails it when the panelist
 * has an address. round (with application.candidate/vacancy) is optional
 * context for the email. Returns { url, emailed } - the url is always
 * returned so HR can pass it on another way (WhatsApp, printed, read aloud).
 */
async function issueLink(panelMember, round) {
  await revokeOutstandingTokens(panelMember.id);
  const token = await createAccessToken(panelMember.id);
  const url = `${frontendUrl}/panel-score/${token}`;

  let emailed = false;
  if (panelMember.email) {
    const context = round?.application
      ? `<p>Candidate: <strong>${escapeHtml(round.application.candidate.fullName)}</strong><br>
Vacancy: ${escapeHtml(round.application.vacancy.jobRef)} ${escapeHtml(round.application.vacancy.title)} (round ${round.roundNumber})<br>
Interview: ${escapeHtml(formatWhen(round.scheduledDate))}</p>`
      : '';
    const info = await sendMail({
      to: panelMember.email,
      subject: 'Interview scoring request - UCAA e-Recruitment',
      html: `<p>Hi ${escapeHtml(panelMember.name)},</p>${context}<p>Please submit your interview score using the link below. This link is single-use and expires in 14 days.</p><p><a href="${url}">${url}</a></p>`
    });
    emailed = info !== null;
  }
  return { url, emailed };
}

module.exports = { createAccessToken, validateForView, consumeForSubmit, revokeOutstandingTokens, issueLink, TOKEN_TTL_MS };
