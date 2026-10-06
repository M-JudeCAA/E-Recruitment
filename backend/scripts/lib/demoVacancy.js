// Creating a vacancy in the demo-data seeders the way HR does: upload an
// EXCO-approved requisition that states the job and the scan of it as
// signed, then create the vacancy from the reviewed form. The requisition is generated to match the
// vacancy the seeder wants (scripts/lib/requisitionDocument.js), and each
// one is distinct - a document can only ever open one vacancy.
//
// `api` is the seeder's own fetch helper: api(method, path, { token, json, form }).
const prisma = require('../../src/config/db');
const { buildRequisitionDocx, buildScannedPdf, DEFAULT_SPEC } = require('./requisitionDocument');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CONTRACT_WORDING = { FullTime: 'Permanent and Pensionable', Contract: 'Contract', FixedTermContract: 'Fixed Term Contract' };

let seq = 0;

function plainText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function requisitionSpecFor(body) {
  const position = await prisma.position.findUnique({
    where: { id: Number(body.positionId) }, include: { department: { include: { directorate: true } } }
  });
  if (!position) throw new Error(`Seeder: position ${body.positionId} does not exist`);
  const reportsTo = body.reportsToPositionId
    ? await prisma.position.findUnique({ where: { id: Number(body.reportsToPositionId) } })
    : null;
  seq += 1;
  const list = (items, fallback) => (Array.isArray(items) && items.length ? items.map(String) : fallback);
  return {
    directorate: position.department.directorate?.name,
    department: position.department.name,
    section: null,
    jobTitle: position.name,
    reportsTo: reportsTo?.name || null,
    station: body.location || DEFAULT_SPEC.station,
    advertType: body.postingType,
    vacancies: body.positionsRequired || 1,
    salaryScale: body.salaryScale || DEFAULT_SPEC.salaryScale,
    contractType: CONTRACT_WORDING[body.employmentCategory] || DEFAULT_SPEC.contractType,
    age: body.maximumAge ? `Not above ${body.maximumAge} years` : null,
    excoMinute: `EXCO MIN ${100 + seq}/2026`,
    jobPurpose: plainText(body.jobPurpose) || `To perform the duties of ${position.name} in the ${position.department.name} department.`,
    essential: list(body.essentialRequirements, DEFAULT_SPEC.essential),
    knowledge: list(body.generalKnowledge, ['Knowledge of the Civil Aviation Authority Act.']),
    specialSkills: list(body.specialSkills, DEFAULT_SPEC.specialSkills),
    desirable: list(body.desirableQualifications, ['Relevant professional membership.'])
  };
}

async function createVacancyFromRequisition(api, token, body) {
  const spec = await requisitionSpecFor(body);
  const docx = await buildRequisitionDocx(spec);
  const form = new FormData();
  form.append('document', new Blob([docx], { type: DOCX }), `Job Opening Request - ${spec.jobTitle}.docx`);
  const requisition = await api('POST', '/api/vacancies/requisition', { token, form });
  const scan = new FormData();
  scan.append('document', new Blob([buildScannedPdf(1)], { type: 'application/pdf' }), `Signed requisition - ${spec.jobTitle}.pdf`);
  const signedCopy = await api('POST', '/api/vacancies/requisition/signed-copy', { token, form: scan });
  return api('POST', '/api/vacancies', {
    token,
    json: { ...body, requisitionDocument: requisition.document, requisitionSignedCopy: signedCopy, requisitionConfirmed: true }
  });
}

module.exports = { createVacancyFromRequisition, requisitionSpecFor };
