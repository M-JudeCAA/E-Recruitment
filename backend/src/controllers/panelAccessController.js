const panelMemberModel = require('../models/panelMemberModel');
const panelAccessService = require('../services/panelAccessService');
const interviewService = require('../services/interviewService');
const { sendMail } = require('../utils/mailer');

// HR Officer+ generates a scoped, single-use link for one panelist.
// If the panelist has an email on file it's sent directly; either way the
// link is returned so HR can share it through any other channel
// (WhatsApp, printed, read aloud) for panelists without email at all.
async function generateLink(req, res) {
  const panelMemberId = Number(req.params.panelMemberId);
  const panelMember = await panelMemberModel.findById(panelMemberId);
  if (!panelMember) return res.status(404).json({ error: 'Panel member not found' });
  if (panelMember.score != null) {
    return res.status(422).json({ error: 'This panelist has already been scored' });
  }

  // Regenerating means exactly one active link at a time - any previously
  // issued, unused link for this panelist stops working the moment a new
  // one is created. This matters if a link was sent to the wrong address
  // or otherwise needs to be superseded.
  await panelAccessService.revokeOutstandingTokens(panelMemberId);

  const token = await panelAccessService.createAccessToken(panelMemberId);
  const url = `${process.env.FRONTEND_URL}/panel-score/${token}`;

  let emailed = false;
  if (panelMember.email) {
    await sendMail({
      to: panelMember.email,
      subject: 'Interview scoring request - UCAA e-Recruitment',
      html: `<p>Hi ${panelMember.name},</p><p>Please submit your interview score using the link below. This link is single-use and expires in 14 days.</p><p><a href="${url}">${url}</a></p>`
    });
    emailed = true;
  }

  res.status(201).json({ url, emailed });
}

// Revokes any outstanding, unused links for a panelist - e.g. if a link
// was sent to the wrong address or a panelist should no longer score.
async function revokeAccess(req, res) {
  const panelMemberId = Number(req.params.panelMemberId);
  await panelAccessService.revokeOutstandingTokens(panelMemberId);
  res.json({ message: 'Outstanding scoring links revoked' });
}

// Public - no account, no JWT. Returns only the minimal context a panelist
// needs to score fairly: candidate name, vacancy, round details. No CV,
// no national ID, no other applicants - deliberately narrow exposure since
// this is a lower-trust, unauthenticated context.
async function viewByToken(req, res) {
  try {
    const record = await panelAccessService.validateForView(req.params.token);
    const round = record.panelMember.interviewRound;
    res.json({
      panelistName: record.panelMember.name,
      candidateName: round.application.candidate.fullName,
      vacancyTitle: round.application.vacancy.title,
      roundNumber: round.roundNumber,
      scheduledDate: round.scheduledDate,
      mode: round.mode
    });
  } catch (err) {
    res.status(410).json({ error: err.message });
  }
}

// Public - the panelist's own submission. selfSubmitted distinguishes this
// from an HR-proxied entry in every downstream audit view.
async function submitByToken(req, res) {
  try {
    const record = await panelAccessService.consumeForSubmit(req.params.token);
    const { score, comments } = req.body;

    await panelMemberModel.update(record.panelMemberId, {
      score, comments, selfSubmitted: true, submittedAt: new Date()
    });
    await interviewService.recomputeRoundScoreFor(record.panelMemberId);

    res.json({ message: 'Score submitted. Thank you.' });
  } catch (err) {
    res.status(410).json({ error: err.message });
  }
}

module.exports = { generateLink, revokeAccess, viewByToken, submitByToken };
