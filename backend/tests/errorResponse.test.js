const multer = require('multer');
const {
  AppError, classifyError, sendError, errorHandler, GENERIC_MESSAGE, UNAVAILABLE_MESSAGE
} = require('../src/utils/errorResponse');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Shaped like the real thing without importing @prisma/client (tests never touch it).
function prismaError(name, message, code) {
  const err = new Error(message);
  err.name = name;
  if (code) err.code = code;
  return err;
}

const DB_MESSAGE = 'Invalid `prisma.staffUser.findUnique()` invocation in D:\\app\\staffModel.js:4:44 Can\'t reach database server at `mysql-32b198ce-caa-48e5.l.aivencloud.com:17434`';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => console.error.mockRestore());

describe('classifyError', () => {
  it('reports an unreachable database as 503 without leaking the host or query', () => {
    const err = prismaError('PrismaClientInitializationError', DB_MESSAGE, 'P1001');
    const result = classifyError(err, 500);
    expect(result.status).toBe(503);
    expect(result.message).toBe(UNAVAILABLE_MESSAGE);
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toMatch(/aivencloud|prisma|findUnique/i);
  });

  it('still reports 503 when a 4xx-fallback call site catches a database outage', () => {
    const err = prismaError('PrismaClientInitializationError', DB_MESSAGE, 'P1001');
    expect(classifyError(err, 422).status).toBe(503);
  });

  it('treats network-level error codes as service unavailable', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3306'), { code: 'ECONNREFUSED' });
    const result = classifyError(err, 500);
    expect(result.status).toBe(503);
    expect(result.message).not.toMatch(/10\.0\.0\.5/);
  });

  it('hides other Prisma errors behind a generic 500', () => {
    const err = prismaError('PrismaClientKnownRequestError', 'Unique constraint failed on the fields: (`email`)', 'P2002');
    const result = classifyError(err, 422);
    expect(result).toEqual({ status: 500, message: GENERIC_MESSAGE });
  });

  it('hides programming errors', () => {
    const result = classifyError(new TypeError("Cannot read properties of undefined (reading 'id')"), 422);
    expect(result).toEqual({ status: 500, message: GENERIC_MESSAGE });
  });

  it('passes through a business-rule message at a 4xx call site', () => {
    const result = classifyError(new Error('Self-approval blocked: route this approval to DHRA / Manager HR instead'), 422);
    expect(result).toEqual({
      status: 422,
      message: 'Self-approval blocked: route this approval to DHRA / Manager HR instead'
    });
  });

  it('hides an arbitrary Error at the 500 global-handler level', () => {
    expect(classifyError(new Error('ENOENT: no such file or directory, open /srv/app/x'), 500))
      .toEqual({ status: 500, message: GENERIC_MESSAGE });
  });

  it('keeps an AppError message and status', () => {
    expect(classifyError(new AppError('Only PDF or Word documents are allowed', 400), 500))
      .toEqual({ status: 400, message: 'Only PDF or Word documents are allowed' });
  });

  it('maps a multer file-size error to 413 with a friendly message', () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE', 'file');
    const result = classifyError(err, 500);
    expect(result.status).toBe(413);
    expect(result.message).toMatch(/too large/i);
  });

  it('does not echo malformed-JSON details from body-parser', () => {
    const err = Object.assign(new SyntaxError('Unexpected token } in JSON at position 42'), {
      type: 'entity.parse.failed', status: 400, expose: true
    });
    const result = classifyError(err, 500);
    expect(result.status).toBe(400);
    expect(result.message).not.toMatch(/token|position/i);
  });
});

describe('sendError', () => {
  it('sends only the sanitized message and logs the original server-side', () => {
    const res = mockRes();
    const err = prismaError('PrismaClientInitializationError', DB_MESSAGE, 'P1001');
    sendError(res, err, 422);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: UNAVAILABLE_MESSAGE, code: 'SERVICE_UNAVAILABLE' });
    expect(console.error).toHaveBeenCalledWith(err);
  });

  it('sends a business error at the caller-supplied status', () => {
    const res = mockRes();
    sendError(res, new Error('This scoring link has expired'), 410);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({ error: 'This scoring link has expired' });
  });
});

describe('errorHandler', () => {
  it('never returns raw error text to the client', () => {
    const res = mockRes();
    errorHandler(new Error('SELECT * FROM StaffUser failed'), {}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: GENERIC_MESSAGE });
  });

  it('delegates to the default handler once headers are already sent', () => {
    const res = { ...mockRes(), headersSent: true };
    const next = jest.fn();
    const err = new Error('boom');
    errorHandler(err, {}, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});
