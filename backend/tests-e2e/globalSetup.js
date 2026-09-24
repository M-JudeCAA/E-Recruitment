const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { testDatabaseUrl } = require('./testDatabaseUrl');

// Builds the test database from schema.prisma with `prisma db push`, not
// from the migration history: the history can't build a database from
// scratch (20260915120000_age_flying_hours_exam_grades alters a column that
// no earlier migration creates - see the READMEs in prisma/migrations about
// changes made directly on the shared database). db push gives exactly the
// schema the code is written against, which is what these tests need.
module.exports = async () => {
  const url = testDatabaseUrl();
  execSync('npx prisma db push --force-reset --skip-generate', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe'
  });
};
