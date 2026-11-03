jest.mock('../src/config/db', () => require('./__mocks__/db'));
const request = require('supertest');
const prisma = require('../src/config/db');
const { productionProblems } = require('../src/config/productionChecks');
const { confirmProduction, refuseInProduction } = require('../scripts/lib/productionGuard');

beforeEach(() => jest.clearAllMocks());

// backend/.env as production has it (deploy/production/README.md, 4.2).
const ready = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(64),
  DATABASE_URL: 'mysql://erec_app:pw@10.10.20.11:3306/erecruitment?connection_limit=20&pool_timeout=20',
  FRONTEND_URL: 'https://careers.caa.co.ug,https://erecruitment.caa.co.ug,https://internal-careers.caa.co.ug',
  UPLOAD_DIR: '/var/lib/erecruitment/uploads',
  INTERNAL_EMAIL_DOMAIN: 'caa.co.ug',
  SMTP_HOST: 'caa-co-ug.mail.protection.outlook.com'
};

describe('production start-up checks', () => {
  test('a complete production configuration has nothing to report', () => {
    expect(productionProblems(ready)).toEqual({ problems: [], warnings: [] });
  });

  test('nothing is checked outside production', () => {
    expect(productionProblems({ NODE_ENV: 'development' })).toEqual({ problems: [], warnings: [] });
  });

  test.each([
    ['a short JWT_SECRET', { JWT_SECRET: 'short' }, /JWT_SECRET/],
    ['no DATABASE_URL', { DATABASE_URL: '' }, /DATABASE_URL/],
    ['no FRONTEND_URL', { FRONTEND_URL: '' }, /FRONTEND_URL is not set/],
    ['a plain http address', { FRONTEND_URL: 'http://careers.caa.co.ug' }, /must use https/],
    ['no UPLOAD_DIR', { UPLOAD_DIR: '' }, /UPLOAD_DIR/],
    ['no INTERNAL_EMAIL_DOMAIN', { INTERNAL_EMAIL_DOMAIN: '' }, /INTERNAL_EMAIL_DOMAIN/]
  ])('refuses to start with %s', (_, change, message) => {
    const { problems } = productionProblems({ ...ready, ...change });
    expect(problems).toEqual([expect.stringMatching(message)]);
  });

  test('warns about email that will not go out', () => {
    const { problems, warnings } = productionProblems({ ...ready, SMTP_HOST: 'json' });
    expect(problems).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/SMTP_HOST=json/)]);
  });
});

describe('scripts that empty or fill a database with demo data', () => {
  let exit;
  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('a wipe in production needs --production as well as --yes', () => {
    const prod = { NODE_ENV: 'production' };
    expect(() => confirmProduction('resetDemoData', ['node', 'x', '--yes'], prod)).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(confirmProduction('resetDemoData', ['node', 'x', '--yes', '--production'], prod)).toBe(true);
    expect(confirmProduction('resetDemoData', ['node', 'x', '--yes'], { NODE_ENV: 'development' })).toBe(true);
  });

  test('demo seeders never run in production', () => {
    expect(() => refuseInProduction('seedFullWorkflowDemoData', { NODE_ENV: 'production' })).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(() => refuseInProduction('seedFullWorkflowDemoData', {})).not.toThrow();
  });
});

describe('GET /health/ready', () => {
  const app = require('../src/app');

  test('ok while the database answers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  test('503 when the database server cannot be reached', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    prisma.$queryRaw.mockRejectedValue(new Error("Can't reach database server"));
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', database: 'unreachable' });
  });
});
