const prisma = require('../config/db');
const conflictOfInterest = require('../services/conflictOfInterestService');
const accessLog = require('../services/accessLogService');
const audit = require('../services/auditService');

// The candidate database (FR-ATS-051/052): HR's tags on candidates, and a
// keyword search over everyone who has applied - past applicants included.
// Only candidates who submitted an application (and so consented to UCAA
// keeping their data, FR-ATS-038) are searchable, never anyone whose data
// was erased, and never a staff member's own rivals: a candidate who
// applied for a vacancy the searcher applied for is left out. Searches that
// show candidates are recorded in the access log.

const MAX_TAG = 60;
const PAGE = 25;

// --- tags ---

async function listTags(req, res) {
  const tags = await prisma.candidateTag.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { taggings: true } } } });
  res.json(tags.map((t) => ({ id: t.id, name: t.name, candidates: t._count.taggings })));
}

function tagName(input) {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG) : '';
  return name.length >= 2 ? name : null;
}

// POST /api/talent/tags { name } - returns the tag, new or existing.
async function createTag(req, res) {
  const name = tagName(req.body.name);
  if (!name) return res.status(400).json({ error: 'A tag needs a name of 2 to 60 characters' });
  const existing = await prisma.candidateTag.findFirst({ where: { name } });
  if (existing) return res.json(existing);
  try {
    res.status(201).json(await prisma.candidateTag.create({ data: { name, createdById: req.user.id } }));
  } catch (err) {
    if (err.code === 'P2002') return res.json(await prisma.candidateTag.findFirst({ where: { name } }));
    throw err;
  }
}

// DELETE /api/talent/tags/:tagId - takes it off everyone (Senior HR Officer+).
async function deleteTag(req, res) {
  const id = Number(req.params.tagId);
  const tag = Number.isInteger(id) ? await prisma.candidateTag.findUnique({ where: { id } }) : null;
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  await prisma.candidateTag.delete({ where: { id } });
  await audit.record({ entityType: 'CandidateTag', entityId: id, action: 'Tag deleted', actor: audit.actorFrom(req), details: { name: tag.name } });
  res.status(204).end();
}

async function tagsOf(candidateId) {
  const rows = await prisma.candidateTagging.findMany({ where: { candidateId }, include: { tag: true }, orderBy: { addedAt: 'asc' } });
  return rows.map((r) => ({ id: r.tag.id, name: r.tag.name }));
}

// POST /api/talent/candidates/:candidateId/tags { tagId } or { name } (made if new).
async function addTag(req, res) {
  const candidateId = Number(req.params.candidateId);
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true, purgedAt: true } });
  if (!candidate || candidate.purgedAt) return res.status(404).json({ error: 'Candidate not found' });
  let tag;
  if (req.body.tagId) {
    tag = await prisma.candidateTag.findUnique({ where: { id: Number(req.body.tagId) } });
  } else {
    const name = tagName(req.body.name);
    if (!name) return res.status(400).json({ error: 'A tag needs a name of 2 to 60 characters' });
    tag = await prisma.candidateTag.findFirst({ where: { name } })
      || await prisma.candidateTag.create({ data: { name, createdById: req.user.id } }).catch(() => prisma.candidateTag.findFirst({ where: { name } }));
  }
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  await prisma.candidateTagging.upsert({
    where: { candidateId_tagId: { candidateId, tagId: tag.id } },
    create: { candidateId, tagId: tag.id, addedById: req.user.id }, update: {}
  });
  res.json(await tagsOf(candidateId));
}

// DELETE /api/talent/candidates/:candidateId/tags/:tagId
async function removeTag(req, res) {
  const candidateId = Number(req.params.candidateId);
  await prisma.candidateTagging.deleteMany({ where: { candidateId, tagId: Number(req.params.tagId) } });
  res.json(await tagsOf(candidateId));
}

// --- search ---

// GET /api/talent/candidates?q=&tags=1,2&candidateType=&page=
// q matches words anywhere in the name, email, phone, residence, district,
// education, employers and job titles, or certificates - every word must match somewhere.
async function search(req, res) {
  const words = String(req.query.q || '').trim().split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  const tagIds = String(req.query.tags || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const page = Math.max(1, Number(req.query.page) || 1);
  const conflicted = await conflictOfInterest.conflictedVacancyIds(req);

  const wordMatch = (w) => ({
    OR: [
      { fullName: { contains: w } }, { email: { contains: w } }, { phone: { contains: w } },
      { location: { contains: w } }, { districtOfOrigin: { contains: w } },
      { education: { some: { OR: [{ institution: { contains: w } }, { fieldOfStudy: { contains: w } }, { qualificationLevelText: { contains: w } }] } } },
      { workExperience: { some: { OR: [{ employer: { contains: w } }, { jobTitle: { contains: w } }] } } },
      { certificates: { some: { OR: [{ name: { contains: w } }, { issuingOrganization: { contains: w } }] } } }
    ]
  });
  const where = {
    purgedAt: null,
    applications: { some: { submittedDate: { not: null } } },
    ...(conflicted.length ? { NOT: { applications: { some: { vacancyId: { in: conflicted }, status: { not: 'Draft' } } } } } : {}),
    ...(['Internal', 'External'].includes(req.query.candidateType) ? { candidateType: req.query.candidateType } : {}),
    AND: [...words.map(wordMatch), ...tagIds.map((tagId) => ({ tags: { some: { tagId } } }))]
  };
  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE,
      select: {
        id: true, fullName: true, email: true, phone: true, candidateType: true, location: true, districtOfOrigin: true,
        education: { select: { qualificationLevelText: true, fieldOfStudy: true, institution: true }, take: 3 },
        workExperience: { select: { jobTitle: true, employer: true }, orderBy: { startDate: 'desc' }, take: 2 },
        tags: { select: { tag: { select: { id: true, name: true } } } },
        applications: {
          where: { status: { not: 'Draft' } }, orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, submittedDate: true, vacancy: { select: { id: true, jobRef: true, title: true } }, offer: { select: { status: true } } }
        }
      }
    })
  ]);
  if (rows.length) {
    await accessLog.record(req, {
      action: 'Searched candidates', candidateIds: rows.map((r) => r.id),
      detail: { search: words.join(' '), tags: tagIds, page }
    });
  }
  res.json({
    total, page, limit: PAGE,
    data: rows.map(({ tags, ...c }) => ({ ...c, tags: tags.map((t) => t.tag) }))
  });
}

module.exports = { listTags, createTag, deleteTag, addTag, removeTag, search };
