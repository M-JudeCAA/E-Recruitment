const nodemailer = require('nodemailer');
const systemHealthModel = require('../models/systemHealthModel');

// SMTP_HOST=json swaps in nodemailer's jsonTransport, which "sends" by
// building the message and discarding it - for local development without a
// mail server, and for the end-to-end tests. Anything else is real SMTP.
function buildTransport() {
  if (process.env.SMTP_HOST === 'json') return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
}

const transporter = buildTransport();

// Every send is recorded in SystemHealth ("mail"), so a broken mail setup
// shows up as a warning banner for staff and an alert to Directors (see
// services/systemHealthService.js) instead of only a line in the server log
// while every email silently goes nowhere. Successes are written at most
// every SUCCESS_WRITE_INTERVAL_MS per process, since a healthy mail server
// needs no fresh row per email; a success right after a failure is always
// written, so the warning clears immediately.
const SUCCESS_WRITE_INTERVAL_MS = 10 * 60 * 1000;
let lastSuccessWriteAt = 0;
let lastOutcomeWasFailure = false;

async function recordOutcome(ok, error) {
  try {
    if (ok) {
      const now = Date.now();
      if (!lastOutcomeWasFailure && now - lastSuccessWriteAt < SUCCESS_WRITE_INTERVAL_MS) return;
      await systemHealthModel.recordSuccess('mail');
      lastSuccessWriteAt = now;
      lastOutcomeWasFailure = false;
    } else {
      lastOutcomeWasFailure = true;
      await systemHealthModel.recordFailure('mail', error);
      // Lazy require: systemHealthService pulls in the notification model,
      // and only the failure path needs it.
      await require('../services/systemHealthService').checkAndAlert();
    }
  } catch (err) {
    // Health recording must never turn a send into a crash - it is itself
    // a best-effort side channel (the database may be what's down).
    console.error('Could not record mail health:', err.message);
  }
}

// Still returns null instead of throwing on failure - callers rely on an
// email problem never rolling back the action that triggered it.
// attachments is optional (nodemailer's own shape) - used for the .ics
// calendar invites sent to interview panelists.
async function sendMail({ to, subject, html, attachments }) {
  if (!process.env.SMTP_HOST) {
    console.error(`Failed to send email to ${to}: SMTP_HOST is not set`);
    await recordOutcome(false, 'SMTP_HOST is not set');
    return null;
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM, to, subject, html, ...(attachments ? { attachments } : {})
    });
    await recordOutcome(true);
    return info;
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err.message);
    await recordOutcome(false, err.message);
    return null;
  }
}

// Called once at start-up by the API server and the scheduler worker: checks
// the SMTP settings by connecting and authenticating, so a wrong host or
// password is reported the moment the service starts rather than after the
// first candidate misses an email. Never throws.
async function verifyMailTransport() {
  if (!process.env.SMTP_HOST) {
    console.error('Email is not configured: SMTP_HOST is not set. No emails will be sent.');
    await recordOutcome(false, 'SMTP_HOST is not set');
    return false;
  }
  if (process.env.SMTP_HOST === 'json') return true;
  try {
    await transporter.verify();
    console.log(`Email: connected to ${process.env.SMTP_HOST}.`);
    lastOutcomeWasFailure = true; // force the success write, clearing any stale failure
    await recordOutcome(true);
    return true;
  } catch (err) {
    console.error(`Email is misconfigured - could not connect to ${process.env.SMTP_HOST}:`, err.message);
    await recordOutcome(false, `Start-up check failed: ${err.message}`);
    return false;
  }
}

module.exports = { sendMail, verifyMailTransport };
