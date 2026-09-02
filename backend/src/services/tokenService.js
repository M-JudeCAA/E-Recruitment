const crypto = require('crypto');
const prisma = require('../config/db');

const TOKEN_TTL_MS = {
  PasswordReset: 1000 * 60 * 30             // 30 minutes
};

async function createToken({ type, candidateId = null, staffId = null }) {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.verificationToken.create({
    data: {
      token,
      type,
      candidateId,
      staffId,
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

  await prisma.verificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() }
  });

  return record;
}

module.exports = { createToken, consumeToken };
