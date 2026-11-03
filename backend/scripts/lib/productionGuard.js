// Keeps the scripts that fill a database with made-up people off the
// production system (NODE_ENV=production in backend/.env): production starts
// from UCAA's organisation structure and real accounts only.

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function refuseInProduction(name, env = process.env) {
  if (!isProduction(env)) return;
  console.error(`${name} puts demo data in the database - not in production (NODE_ENV=production). Nothing has been changed.`);
  process.exit(1);
}

module.exports = { isProduction, refuseInProduction };
