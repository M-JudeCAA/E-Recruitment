// Single place that decides what an API caller is allowed to see when
// something throws. Prisma errors embed the failing query and the database
// host:port ("Invalid `prisma.staffUser.findUnique()` invocation ... Can't
// reach database server at ..."), and plain runtime errors leak internals
// like "Cannot read properties of undefined" - neither belongs in a browser.
// The full error is always logged server-side; the client only gets a
// generic message (and a 503 when the cause is the database/network being
// unreachable, which the frontend renders as "server offline").

const GENERIC_MESSAGE = 'Something went wrong on our side. Please try again in a moment.';
const UNAVAILABLE_MESSAGE = 'The service is temporarily unavailable. Please try again shortly.';

// Prisma codes meaning "could not talk to the database at all" (as opposed
// to a query-level problem): auth failed, unreachable, timed out, db
// missing, TLS failure, connection closed, pool timeout, too many connections.
const DB_UNAVAILABLE_CODES = new Set([
  'P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1011', 'P1017', 'P2024', 'P2037'
]);

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH'
]);

// For a message that is deliberately written for the end user and safe to
// show (multer file-type rejections, etc.) - as opposed to an arbitrary
// Error, whose message is not vetted.
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.isAppError = true;
  }
}

function isDatabaseUnavailable(err) {
  if (!err) return false;
  return (
    err.name === 'PrismaClientInitializationError' ||
    err.name === 'PrismaClientRustPanicError' ||
    DB_UNAVAILABLE_CODES.has(err.code) ||
    NETWORK_ERROR_CODES.has(err.code)
  );
}

// Anything whose message is not written for end users: Prisma errors of
// every kind (validation, known-request, unknown) and programming errors.
function isInternalError(err) {
  if (!err) return false;
  return (
    (typeof err.name === 'string' && err.name.startsWith('PrismaClient')) ||
    (typeof err.code === 'string' && /^P\d{4}$/.test(err.code)) ||
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof RangeError
  );
}

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: [413, 'The file is too large. Please upload a smaller file.'],
  LIMIT_UNEXPECTED_FILE: [400, 'That file could not be accepted. Please check the upload and try again.']
};

/**
 * Maps a thrown value to { status, message, code? } that is safe to send.
 *
 * `fallbackStatus` is the status the calling site already uses for its own
 * deliberate business errors (e.g. 422 around workflow/eligibility checks,
 * where the thrown message is intentional user-facing text). At >= 500 (the
 * global handler) a plain Error's message is treated as unvetted and hidden.
 */
function classifyError(err, fallbackStatus = 500) {
  if (err && err.isAppError) {
    return { status: err.status || 400, message: err.message };
  }
  if (isDatabaseUnavailable(err)) {
    return { status: 503, message: UNAVAILABLE_MESSAGE, code: 'SERVICE_UNAVAILABLE' };
  }
  if (isInternalError(err)) {
    return { status: 500, message: GENERIC_MESSAGE };
  }
  // express.json() failures - the raw message quotes the malformed JSON.
  if (err && err.type === 'entity.parse.failed') {
    return { status: 400, message: 'The request could not be understood.' };
  }
  if (err && err.type === 'entity.too.large') {
    return { status: 413, message: 'The request is too large.' };
  }
  if (err && err.name === 'MulterError') {
    const [status, message] = MULTER_MESSAGES[err.code] || [400, 'The file upload could not be processed.'];
    return { status, message };
  }
  if (fallbackStatus < 500 && err && typeof err.message === 'string' && err.message) {
    return { status: fallbackStatus, message: err.message };
  }
  // http-errors (e.g. from body-parser) marks 4xx messages as safe via `expose`.
  if (err && err.expose === true && err.status < 500 && typeof err.message === 'string' && err.message) {
    return { status: err.status, message: err.message };
  }
  return { status: 500, message: GENERIC_MESSAGE };
}

// For controller catch blocks: replaces `res.status(422).json({ error: err.message })`.
function sendError(res, err, fallbackStatus = 500) {
  const { status, message, code } = classifyError(err, fallbackStatus);
  if (status >= 500) console.error(err);
  return res.status(status).json(code ? { error: message, code } : { error: message });
}

// Express error-handling middleware (4-arg signature is required).
function errorHandler(err, req, res, next) {
  console.error(err);
  if (res.headersSent) return next(err);
  const { status, message, code } = classifyError(err, 500);
  res.status(status).json(code ? { error: message, code } : { error: message });
}

module.exports = { AppError, classifyError, sendError, errorHandler, GENERIC_MESSAGE, UNAVAILABLE_MESSAGE };
