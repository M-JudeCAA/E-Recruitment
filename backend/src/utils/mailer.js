const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined
});

async function sendMail({ to, subject, html }) {
  try {
    return await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html
    });
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err.message);
    return null;
  }
}

module.exports = { sendMail };
