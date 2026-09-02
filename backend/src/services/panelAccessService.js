const crypto = require('crypto');
const panelAccessTokenModel = require('../models/panelAccessTokenModel');

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
 * before submitting.
 */
async function validateForView(token) {
  const record = await panelAccessTokenModel.findByToken(token);
  if (!record) throw new Error('Invalid access link');
  if (record.usedAt) throw new Error('This scoring link has already been used');
  if (record.expiresAt < new Date()) throw new Error('This scoring link has expired');
  if (record.panelMember.score != null) throw new Error('A score has already been recorded for this panelist');
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

module.exports = { createAccessToken, validateForView, consumeForSubmit, revokeOutstandingTokens };
