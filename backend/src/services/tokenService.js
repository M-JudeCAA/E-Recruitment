const crypto = require('crypto');
const prisma = require('../config/db');

const TOKEN_TTL_MS = {
  EmailConfirmation: 1000 * 60 * 60 * 24,   // 24 hours
  PasswordReset: 1000 * 60 * 30             // 30 minutes
};

async function createToken({ type, candidateId = null, staffId = null, pendingRegistrationId = null }) {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.verificationToken.create({
    data: {
      token,
      type,
      candidateId,
      staffId,
      pendingRegistrationId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type])
    }
  });
  return token;
}

/**
 * Validates and consumes a token in one step (marks usedAt), so a token
 * cannot be replayed. Returns the token record, or throws.
 */
async function consumeToken(token, expectedType) {
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record || record.type !== expectedType) {
    throw new Error('Invalid or unknown token');
  }
  if (record.usedAt) {
    throw new Error('This link has already been used');
  }
  if (record.expiresAt < new Date()) {
    throw new Error('This link has expired');
  }

  // Conditional on still being unused, so two requests racing with the same
  // link can't both get through.
  const { count } = await prisma.verificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() }
  });
  if (count !== 1) throw new Error('This link has already been used');

  return record;
}

module.exports = { createToken, consumeToken };
