const prisma = require('../config/db');
const templates = require('../services/templateService');
const conflictOfInterest = require('../services/conflictOfInterestService');
const audit = require('../services/auditService');
const { sendMail } = require('../utils/mailer');
const { sanitizeJobDescription } = require('../utils/htmlSanitizer');
const { escapeHtml } = require('../utils/interviewFormat');

// Bulk email (FR-ATS-050): one message, from an email template, to many
// candidates at once - picked as applications on a vacancy's board or as
// candidates in the candidate search. HR can change the subject and wording
// for this send; {{placeholders}} are filled per recipient. Each send is
// kept (BulkEmail + one BulkEmailRecipient per person) and audited.
// Senior HR Officer+. Applicants for a vacancy the sender applied for can't
// be emailed this way (409, the usual conflict of interest).

const MAX_RECIPIENTS = 500;
const MAX_SUBJECT = 200;
const TZ = () => process.env.APP_TIMEZONE || 'Africa/Kampala';

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ() });

function fillText(text, ctx) {
  return String(text).replace(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g, (whole, k) => (k in ctx ? String(ctx[k] ?? '') : whole));
}

// The people the request names: { applicationIds } (with their vacancy)
// or { candidateIds }. Returns { recipients, vacancyIds } or { error }.
async function resolveRecipients(body) {
  const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const applicationIds = ids(body.applicationIds);
  const candidateIds = ids(body.candidateIds);
  if (!applicationIds.length && !candidateIds.length) return { error: 'Choose who to send it to' };
  if (applicationIds.length + candidateIds.length > MAX_RECIPIENTS) return { error: `At most ${MAX_RECIPIENTS} people in one send` };

  const recipients = [];
  if (applicationIds.length) {
    const apps = await prisma.application.findMany({
      where: { id: { in: applicationIds }, status: { not: 'Draft' } },
      select: {
        id: true, vacancyId: true, candidate: { select: { id: true, fullName: true, email: true, purgedAt: true } },
        vacancy: { select: { jobRef: true, title: true, department: { select: { name: true } } } }
      }
    });
    for (const a of apps) {
      recipients.push({
        candidateId: a.candidate.id, applicationId: a.id, vacancyId: a.vacancyId, email: a.candidate.email, purged: Boolean(a.candidate.purgedAt),
        ctx: { candidateName: a.candidate.fullName, jobTitle: a.vacancy.title, jobRef: a.vacancy.jobRef, department: a.vacancy.department?.name }
      });
    }
  }
  if (candidateIds.length) {
    const people = await prisma.candidate.findMany({
      where: { id: { in: candidateIds } },
      select: {
        id: true, fullName: true, email: true, purgedAt: true,
        applications: {
          where: { status: { not: 'Draft' } }, orderBy: { createdAt: 'desc' },
          select: { id: true, vacancyId: true, vacancy: { select: { jobRef: true, title: true, department: { select: { name: true } } } } }
        }
      }
    });
    for (const c of people) {
      // The job placeholders come from their most recent application.
      const latest = c.applications[0];
      recipients.push({
        candidateId: c.id, applicationId: latest?.id || null, vacancyId: null, otherVacancyIds: c.applications.map((x) => x.vacancyId),
        email: c.email, purged: Boolean(c.purgedAt),
        ctx: { candidateName: c.fullName, jobTitle: latest?.vacancy.title || '', jobRef: latest?.vacancy.jobRef || '', department: latest?.vacancy.department?.name || '' }
      });
    }
  }
  const usable = recipients.filter((r) => !r.purged);
  const vacancyIds = [...new Set(usable.flatMap((r) => [r.vacancyId, ...(r.otherVacancyIds || [])]).filter(Boolean))];
  return { recipients: usable, vacancyIds };
}

async function compose(body) {
  const key = typeof body.templateKey === 'string' ? body.templateKey : null;
  const template = key ? await templates.get(key) : null;
  if (key && template.kind !== 'email') return { error: 'Choose an email template' };
  const subject = String(body.subject ?? template?.subject ?? '').trim().slice(0, MAX_SUBJECT);
  const html = sanitizeJobDescription(String(body.body ?? template?.body ?? ''));
  if (!subject) return { error: 'Give the email a subject' };
  if (!html.replace(/<[^>]*>/g, '').trim()) return { error: 'The email is empty' };
  return { key, subject, html };
}

// GET /api/bulk-email/templates - the email templates to start from.
async function listTemplates(req, res) {
  const all = await templates.list();
  const emails = await Promise.all(all.filter((t) => t.kind === 'email').map((t) => templates.get(t.key)));
  res.json(emails.map((t) => ({ key: t.key, name: t.name, description: t.description, subject: t.subject, body: t.body, placeholders: t.placeholders })));
}

// POST /api/bulk-email/preview - who it goes to and the first copy, filled.
async function preview(req, res) {
  const message = await compose(req.body);
  if (message.error) return res.status(400).json({ error: message.error });
  const { recipients, error } = await resolveRecipients(req.body);
  if (error) return res.status(400).json({ error });
  const first = recipients[0];
  const ctx = { date: today(), ...(first?.ctx || {}) };
  res.json({
    count: recipients.length,
    recipients: recipients.slice(0, 50).map((r) => ({ name: r.ctx.candidateName, email: r.email, job: r.ctx.jobRef || null })),
    subject: fillText(message.subject, ctx),
    html: templates.fill(message.key || 'emailGeneral', message.html, ctx)
  });
}

// POST /api/bulk-email/send { templateKey?, subject, body, applicationIds | candidateIds }
async function send(req, res) {
  const message = await compose(req.body);
  if (message.error) return res.status(400).json({ error: message.error });
  const { recipients, vacancyIds, error } = await resolveRecipients(req.body);
  if (error) return res.status(400).json({ error });
  if (!recipients.length) return res.status(400).json({ error: 'None of the people chosen can be emailed' });
  for (const vacancyId of vacancyIds) {
    if (await conflictOfInterest.isConflicted(req, vacancyId)) {
      return res.status(409).json({ error: 'Some of these candidates applied for a vacancy you applied for - you cannot email them', code: 'APPLICANT_CONFLICT' });
    }
  }
  const singleVacancy = new Set(recipients.map((r) => r.vacancyId)).size === 1 ? recipients[0].vacancyId : null;

  const results = [];
  for (const r of recipients) {
    const ctx = { date: today(), ...r.ctx };
    let sent = false;
    try {
      const info = await sendMail({
        to: r.email,
        subject: fillText(message.subject, ctx),
        html: `${templates.fill(message.key || 'emailGeneral', message.html, ctx)}<hr><p style="font-size:12px;color:#666">${escapeHtml('Uganda Civil Aviation Authority - e-Recruitment')}</p>`
      });
      sent = info !== null;
    } catch (err) {
      console.error(`Bulk email to ${r.email} failed:`, err.message);
    }
    results.push({ ...r, sent });
  }
  const failed = results.filter((r) => !r.sent).length;
  const bulk = await prisma.bulkEmail.create({
    data: {
      templateKey: message.key, subject: message.subject, body: message.html, vacancyId: singleVacancy, sentById: req.user.id,
      recipientCount: results.length, failedCount: failed,
      recipients: { create: results.map((r) => ({ candidateId: r.candidateId, applicationId: r.applicationId, email: r.email, sent: r.sent })) }
    }
  });
  await audit.record({
    entityType: singleVacancy ? 'Vacancy' : 'BulkEmail', entityId: singleVacancy || bulk.id, action: 'Bulk email sent', actor: audit.actorFrom(req),
    details: { bulkEmailId: bulk.id, subject: message.subject, template: message.key, recipients: results.length, failed }
  });
  res.status(201).json({ id: bulk.id, sent: results.length - failed, failed, failedTo: results.filter((r) => !r.sent).map((r) => r.email) });
}

// GET /api/bulk-email?vacancyId= - sends so far (newest first).
async function list(req, res) {
  const vacancyId = Number(req.query.vacancyId);
  const rows = await prisma.bulkEmail.findMany({
    where: Number.isInteger(vacancyId) && vacancyId > 0 ? { vacancyId } : {},
    orderBy: { sentAt: 'desc' }, take: 50,
    include: { sentBy: { select: { id: true, name: true } } }
  });
  res.json(rows.map(({ body, ...r }) => r));
}

module.exports = { listTemplates, preview, send, list, fillText };
