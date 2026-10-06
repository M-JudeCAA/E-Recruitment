const crypto = require('crypto');
const fs = require('fs');
const prisma = require('../config/db');
const { uploadPath } = require('../utils/uploadFiles');
const { refYear } = require('../utils/jobRefGenerator');
const { AppError } = require('../utils/errorResponse');

// "Mark as Hired" (FR-ATS-067 to 069, BR-ATS-11): turns an accepted offer
// into exactly one onboarding case, with the signed appointing instrument
// attached. The case gets its own reference, UCAA/ONB/NNN/YYYY, numbered
// like job references (the JobRefSequence row 'ONB' for the year, under its
// lock, in the same transaction - so a number is never reused or skipped).
// applicationId and offerId are unique on Hire, so a second request -
// a double click, two HR users at once - gets the case already made.
// The handoff to the HRIS is hrisHandoffService's.

const ONB = 'ONB';
const formatCaseRef = (n, year) => `UCAA/ONB/${String(n).padStart(3, '0')}/${year}`;

async function sha256Of(url) {
  const file = uploadPath(url);
  if (!file) return null;
  try {
    return crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('hex');
  } catch (err) {
    return null;
  }
}

const document = async (kind, url, name) => (url ? { kind, name, url, sha256: await sha256Of(url) } : null);

/** What the HRIS receives: the person, the job, the terms, the documents. */
async function buildPackage(offerId, signed) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      application: {
        include: {
          documents: { select: { category: true, label: true, originalName: true, fileUrl: true } },
          vacancy: { include: { department: { include: { directorate: true } }, position: true, reportsToPosition: true } },
          candidate: {
            include: {
              education: true, workExperience: true, certificates: true,
              internalProfile: { select: { employeeId: true, position: true, department: true } }
            }
          }
        }
      }
    }
  });
  const { candidate: c, vacancy: v } = offer.application;
  const docs = await Promise.all([
    document('SignedAppointingInstrument', signed.url, signed.name),
    document('CV', offer.application.cvUrl, 'CV'),
    ...offer.application.documents.map((d) => document(d.category, d.fileUrl, d.label || d.originalName))
  ]);
  return {
    person: {
      fullName: c.fullName, email: c.email, phone: c.phone, nationalId: c.nationalId, dateOfBirth: c.dateOfBirth,
      districtOfOrigin: c.districtOfOrigin, residence: c.location, candidateType: c.candidateType,
      employeeId: c.internalProfile?.employeeId || null
    },
    education: c.education.map((e) => ({ institution: e.institution, qualification: e.qualificationLevelText, level: e.qualificationLevel, fieldOfStudy: e.fieldOfStudy, yearCompleted: e.yearCompleted })),
    workExperience: c.workExperience.map((w) => ({ employer: w.employer, title: w.jobTitle, startDate: w.startDate, endDate: w.endDate })),
    certificates: c.certificates.map((x) => ({ name: x.name, issuer: x.issuingOrganization, issueDate: x.issueDate, expiryDate: x.expiryDate })),
    job: {
      jobRef: v.jobRef, title: v.title, position: v.position?.name, positionId: v.positionId, department: v.department?.name,
      directorate: v.department?.directorate?.name, reportsTo: v.reportsToPosition?.name || null, salaryScale: v.salaryScale, dutyStation: offer.dutyStation || v.location
    },
    terms: {
      salaryAmount: offer.salaryAmount, salaryCurrency: offer.salaryCurrency, salaryPeriod: offer.salaryPeriod, allowances: offer.allowances,
      employmentCategory: offer.employmentCategory, contractMonths: offer.contractMonths, startDate: offer.startDate,
      conditions: offer.conditions, acceptedAt: offer.decidedAt
    },
    documents: docs.filter(Boolean)
  };
}

/**
 * Marks the candidate on an accepted offer hired. Returns { hire, created }.
 * signed: { url, name } of the uploaded signed appointing instrument.
 */
async function markHired(offerId, signed, staffId, now = new Date()) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { hire: true, application: { select: { id: true, candidateId: true, vacancyId: true, vacancy: { select: { positionId: true } } } } }
  });
  if (!offer) throw new AppError('Offer not found', 404);
  if (offer.hire) return { hire: offer.hire, created: false };
  if (offer.status !== 'Accepted') throw new AppError('Only a candidate who has accepted their offer can be marked hired', 422);
  if (!signed?.url) {
    const err = new AppError('Attach the signed appointing instrument', 400);
    err.code = 'SIGNED_INSTRUMENT_REQUIRED';
    throw err;
  }

  const pkg = await buildPackage(offerId, signed);
  const positionId = offer.application.vacancy?.positionId || null;
  try {
    const hire = await prisma.$transaction(async (tx) => {
      const year = refYear(now);
      await tx.$executeRaw`INSERT INTO JobRefSequence (typeCode, year, lastNumber) VALUES (${ONB}, ${year}, 1)
        ON DUPLICATE KEY UPDATE lastNumber = lastNumber + 1`;
      const sequence = await tx.jobRefSequence.findUnique({ where: { typeCode_year: { typeCode: ONB, year } } });
      const created = await tx.hire.create({
        data: {
          applicationId: offer.application.id, offerId, vacancyId: offer.application.vacancyId, candidateId: offer.application.candidateId,
          positionId, caseRef: formatCaseRef(sequence.lastNumber, year), startDate: offer.startDate,
          signedInstrumentUrl: signed.url, signedInstrumentName: signed.name, package: pkg,
          handoffStatus: process.env.HRIS_HANDOFF_URL ? 'Pending' : 'NotConfigured', hiredAt: now, hiredById: staffId
        }
      });
      // One more post filled, where the position's headcount is kept.
      if (positionId) {
        await tx.position.updateMany({ where: { id: positionId, headcount: { not: null } }, data: { occupied: { increment: 1 } } });
      }
      return created;
    }, { timeout: 15000, maxWait: 5000 });
    return { hire, created: true };
  } catch (err) {
    // Someone marked them hired at the same moment - theirs stands.
    if (err.code === 'P2002') {
      const existing = await prisma.hire.findUnique({ where: { offerId } });
      if (existing) return { hire: existing, created: false };
    }
    throw err;
  }
}

module.exports = { markHired, buildPackage, formatCaseRef };
