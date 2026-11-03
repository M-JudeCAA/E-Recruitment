jest.mock('../src/config/db', () => require('./__mocks__/db'));
const request = require('supertest');
const prisma = require('../src/config/db');
const { productionProblems } = require('../src/config/productionChecks');
const { confirmProduction, refuseInProduction } = require('../scripts/lib/productionGuard');

beforeEach(() => jest.clearAllMocks());

const ready = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'mysql://erec:pw@db.caa.co.ug:3306/erecruitment?sslaccept=strict',
  FRONTEND_URL: 'https://erecruitment.caa.co.ug,https://erecruitment.caa.co.ug:4174,https://erecruitment.caa.co.ug:4175',
  UPLOAD_DIR: 'D:\\eRecruitment\\uploads',
  INTERNAL_EMAIL_DOMAIN: 'caa.co.ug',
  SMTP_HOST: 'smtp.caa.co.ug'
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
    ['a plain http address', { FRONTEND_URL: 'http://erecruitment.caa.co.ug' }, /must use https/],
    ['no UPLOAD_DIR', { UPLOAD_DIR: '' }, /UPLOAD_DIR/],
    ['no INTERNAL_EMAIL_DOMAIN', { INTERNAL_EMAIL_DOMAIN: '' }, /INTERNAL_EMAIL_DOMAIN/]
  ])('refuses to start with %s', (_, change, message) => {
    const { problems } = productionProblems({ ...ready, ...change });
    expect(problems).toEqual([expect.stringMatching(message)]);
  });

  test('warns about email that will not go out and an unencrypted remote database', () => {
    const { problems, warnings } = productionProblems({
      ...ready, SMTP_HOST: 'json', DATABASE_URL: 'mysql://erec:pw@db.caa.co.ug:3306/erecruitment'
    });
    expect(problems).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/SMTP_HOST=json/), expect.stringMatching(/may not be encrypted/)]);
  });

  test('a database on the same machine needs no TLS', () => {
    const { warnings } = productionProblems({ ...ready, DATABASE_URL: 'mysql://erec:pw@localhost:3306/erecruitment' });
    expect(warnings).toEqual([]);
  });
});

describe('scripts that empty or fill a database with demo data', () => {
  let exit;
  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('a reset in production needs --production as well as --yes', () => {
    const prod = { NODE_ENV: 'production' };
    expect(() => confirmProduction('resetDemoData', ['node', 'x', '--yes'], prod)).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(confirmProduction('resetDemoData', ['node', 'x', '--yes', '--production'], prod)).toBe(true);
    expect(confirmProduction('resetDemoData', ['node', 'x', '--yes'], { NODE_ENV: 'development' })).toBe(true);
  });

  test('demo seeders never run in production', () => {
    expect(() => refuseInProduction('seedFullWorkflowDemoData', { NODE_ENV: 'production' })).toThrow('exit');
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
