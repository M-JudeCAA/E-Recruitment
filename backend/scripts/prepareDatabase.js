// Brings the database up to date before the API starts on a fresh host
// (Render's pre-deploy command, see render.yaml).
//
//   npm run db:prepare     (node scripts/prepareDatabase.js)
//
// `prisma migrate deploy` can't build an empty database: the migration
// history alters a column no earlier migration creates (see "Known gaps"
// in CLAUDE.md). So on an EMPTY database this creates the schema straight
// from schema.prisma with `prisma db push` - the same thing the e2e suite
// does - and then marks every existing migration as already applied, so
// later deploys only run migrations added after today. On a database that
// already has tables it is just `prisma migrate deploy`.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const prisma = require('../src/config/db');

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');

function prismaCli(args) {
  console.log(`> prisma ${args}`);
  execSync(`npx prisma ${args}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

async function main() {
  const [{ count }] = await prisma.$queryRaw`
    SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()`;
  await prisma.$disconnect();

  if (Number(count) > 0) {
    prismaCli('migrate deploy');
    return;
  }

  console.log('Empty database - creating the schema from schema.prisma and baselining migrations.');
  prismaCli('db push --skip-generate');
  const migrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) prismaCli(`migrate resolve --applied ${name}`);
}

main().catch((err) => {
  console.error('Database preparation failed:', err);
  process.exit(1);
});
