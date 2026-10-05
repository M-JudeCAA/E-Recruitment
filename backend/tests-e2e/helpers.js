const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../src/config/db');
const app = require('../src/app');
const { buildRequisitionDocx } = require('../scripts/lib/requisitionDocument');

const PASSWORD = 'ChangeMe123!';
let passwordHash;

// Empties every table (keeping the schema) so each test starts clean.
async function resetDatabase() {
  const tables = await prisma.$queryRaw`
    SELECT TABLE_NAME AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'`;
  // FOREIGN_KEY_CHECKS is per connection and Prisma pools connections, so
  // every statement must run on the same one - an interactive transaction
  // pins it. (Run separately, a TRUNCATE could land on a connection that
  // still has the checks on, failing at random.)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${name}\``);
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  }, { timeout: 30000 });
}

async function hash() {
  if (!passwordHash) passwordHash = await bcrypt.hash(PASSWORD, 4);
  return passwordHash;
}

async function createStaff(role, email) {
  return prisma.staffUser.create({ data: { name: `${role} ${email.split('@')[0]}`, email, passwordHash: await hash(), role, department: 'HR' } });
}

// Directorate -> approved Department -> Position, as vacancy creation needs.
async function createOrg(createdById) {
  const directorate = await prisma.directorate.create({ data: { name: 'Corporate Affairs', createdById } });
  const department = await prisma.department.create({
    data: { name: 'Human Resources', directorateId: directorate.id, createdById, status: 'Approved', approvedById: createdById, approvedAt: new Date() }
  });
  const position = await prisma.position.create({ data: { name: 'HR Analyst', departmentId: department.id, level: 1, createdById } });
  return { directorate, department, position };
}

// A candidate whose profile is complete enough to submit an application.
let nationalIdSeq = 0;
async function createCandidate({ fullName, email, candidateType = 'External' }) {
  nationalIdSeq += 1;
  return prisma.candidate.create({
    data: {
      fullName, email, candidateType, passwordHash: await hash(), emailConfirmed: true,
      location: 'Kampala', districtOfOrigin: 'Wakiso',
      nationalId: `CM90${String(nationalIdSeq).padStart(10, '0')}`,
      education: { create: [{ institution: 'Makerere University', qualificationLevelText: 'Bachelors', qualificationLevel: 'Bachelors', fieldOfStudy: 'Human Resource Management', yearCompleted: 2015 }] },
      workExperience: { create: [{ employer: 'Uganda Revenue Authority', jobTitle: 'HR Assistant', startDate: new Date('2016-01-01'), endDate: new Date('2022-12-31') }] }
    }
  });
}

async function staffToken(email) {
  const res = await request(app).post('/api/staff/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Staff login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function candidateToken(email) {
  const res = await request(app).post('/api/candidates/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Candidate login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

// Thin wrapper: api(token).get(...) etc., with the bearer token attached.
function api(token) {
  const withAuth = (req) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  return {
    get: (url) => withAuth(request(app).get(url)),
    post: (url, body) => withAuth(request(app).post(url)).send(body || {}),
    patch: (url, body) => withAuth(request(app).patch(url)).send(body || {}),
    delete: (url) => withAuth(request(app).delete(url))
  };
}

const REFEREES = JSON.stringify([
  { name: 'Referee One', phone: '0700000001', email: 'ref1@example.com' },
  { name: 'Referee Two', phone: '0700000002', email: 'ref2@example.com' },
  { name: 'Referee Three', phone: '0700000003', email: 'ref3@example.com' }
]);

// submit() requires at least one academic document on the draft.
async function attachAcademicDocument(token, applicationId) {
  const res = await request(app).post(`/api/applications/${applicationId}/documents`)
    .set('Authorization', `Bearer ${token}`)
    .field('category', 'Academic')
    .attach('file', Buffer.from('%PDF-1.4 test certificate'), { filename: 'certificate.pdf', contentType: 'application/pdf' });
  return expectStatus(res, 201).body;
}

// Uploads an EXCO-approved requisition (a generated Word document - see
// scripts/lib/requisitionDocument.js) and returns what the server read from
// it. Each call makes a distinct document, since one document can only
// ever open one vacancy.
let requisitionSeq = 0;
async function uploadRequisition(token, spec = {}) {
  requisitionSeq += 1;
  const docx = await buildRequisitionDocx({ excoMinute: `EXCO MIN ${requisitionSeq}/2026`, ...spec });
  const res = await request(app).post('/api/vacancies/requisition')
    .set('Authorization', `Bearer ${token}`)
    .attach('document', docx, { filename: 'Job Opening Request.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return expectStatus(res, 200).body;
}

// Creates a vacancy the only way the API allows - from an uploaded
// requisition - with `body` as the reviewed form. Returns the raw response.
async function createVacancyFromRequisition(token, body, spec = {}) {
  const requisition = await uploadRequisition(token, spec);
  return request(app).post('/api/vacancies').set('Authorization', `Bearer ${token}`)
    .send({ ...body, requisitionDocument: requisition.document, requisitionConfirmed: true });
}

function expectStatus(res, status) {
  if (res.status !== status) {
    throw new Error(`Expected ${status} from ${res.req?.method} ${res.req?.path}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}

module.exports = {
  prisma, app, PASSWORD, resetDatabase, createStaff, createOrg, createCandidate, staffToken, candidateToken, api, REFEREES,
  expectStatus, attachAcademicDocument, uploadRequisition, createVacancyFromRequisition
};
