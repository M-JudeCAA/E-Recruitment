// Keeps the scripts that empty a database, or fill it with made-up people,
// off the production system (NODE_ENV=production in backend/.env).
//
//   refuseInProduction(name)  demo-data seeders: never in production
//   confirmProduction(name)   resetDemoData / clearRecruitmentData: only with
//                             --production as well as --yes, so a command
//                             copied from the UAT runbook can't empty
//                             production by mistake

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function refuseInProduction(name, env = process.env) {
  if (!isProduction(env)) return;
  console.error(`${name} puts demo data in the database - not in production (NODE_ENV=production). Nothing has been changed.`);
  process.exit(1);
}

// True when it may go ahead; otherwise explains and exits.
function confirmProduction(name, argv = process.argv, env = process.env) {
  if (!isProduction(env) || argv.includes('--production')) return true;
  console.error(`${name}: this is the PRODUCTION database (NODE_ENV=production).`);
  console.error('Take a backup first (deploy\\lan\\backup.ps1), then add --production to the command if you really mean it.');
  console.error('Nothing has been changed.');
  process.exit(1);
}

module.exports = { isProduction, refuseInProduction, confirmProduction };
