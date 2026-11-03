// What a production API must have before it starts (server.js and the
// scheduler worker call it). `problems` stop it starting - each would sign
// forgeable sessions, lose uploads or send links nobody can open;
// `warnings` are logged and it carries on. Outside production nothing is
// checked: development runs on defaults.

function productionProblems(env = process.env) {
  const problems = [];
  const warnings = [];
  if (env.NODE_ENV !== 'production') return { problems, warnings };

  if (String(env.JWT_SECRET || '').length < 32) {
    problems.push('JWT_SECRET must be a random string of at least 32 characters.');
  }
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set.');

  const origins = String(env.FRONTEND_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length === 0) {
    problems.push('FRONTEND_URL is not set (careers, staff and Internal Careers addresses, in that order).');
  } else {
    const plain = origins.filter((o) => !/^https:\/\//i.test(o));
    if (plain.length) problems.push(`FRONTEND_URL must use https in production: ${plain.join(', ')}.`);
    const local = origins.filter((o) => /\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(o));
    if (local.length) warnings.push(`FRONTEND_URL points at this machine only (${local.join(', ')}) - links in emails won't open elsewhere.`);
  }

  // The default ./uploads sits inside the deployment folder, where a
  // redeploy or a fresh clone loses every CV and signed document.
  if (!env.UPLOAD_DIR) problems.push('UPLOAD_DIR is not set - uploads would be kept inside the code folder.');
  if (!env.INTERNAL_EMAIL_DOMAIN) problems.push('INTERNAL_EMAIL_DOMAIN is not set.');

  if (!env.SMTP_HOST) warnings.push('SMTP_HOST is not set - no email will be sent.');
  else if (env.SMTP_HOST === 'json') warnings.push('SMTP_HOST=json - emails are only logged, never sent.');
  // The database is on another server: say so if the connection isn't
  // encrypted (Prisma's MySQL URL takes sslaccept/sslcert).
  if (env.DATABASE_URL && !/^mysql:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/i.test(env.DATABASE_URL)
    && !/[?&](sslaccept|sslcert)=/i.test(env.DATABASE_URL)) {
    warnings.push('DATABASE_URL reaches another server without sslaccept/sslcert - the database connection may not be encrypted.');
  }
  return { problems, warnings };
}

// Logs the warnings; on any problem, logs them and exits.
function assertProductionReady(label = 'e-Recruitment', env = process.env) {
  const { problems, warnings } = productionProblems(env);
  for (const w of warnings) console.warn(`${label}: ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`${label}: ${p}`);
    console.error(`${label}: not starting - fix backend/.env (deploy/lan/README.md).`);
    process.exit(1);
  }
}

module.exports = { productionProblems, assertProductionReady };
