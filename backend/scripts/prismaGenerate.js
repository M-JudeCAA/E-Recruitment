// Runs `prisma generate` before dev/start/jobs (the pre* hooks in
// package.json). On Windows the generated query engine is a DLL that stays
// locked while any process using it is running, so when the API and the
// scheduler worker run side by side, whichever starts second gets EPERM
// renaming the new engine over the locked one - and used to exit before
// starting. That case only is tolerated: if a client is already generated,
// keep it and carry on. Any other failure (e.g. a schema error) still fails.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const result = spawnSync('npx', ['prisma', 'generate'], {
  cwd: path.join(__dirname, '..'),
  shell: true,
  encoding: 'utf8'
});
const output = `${result.stdout || ''}${result.stderr || ''}`;

if (result.status === 0) {
  process.stdout.write(output);
  process.exit(0);
}

const existingClient = path.join(__dirname, '..', 'node_modules', '.prisma', 'client', 'index.js');
if (/EPERM|EBUSY/.test(output) && fs.existsSync(existingClient)) {
  console.warn(
    'prisma generate: the Prisma engine is locked by another running process (the API or the scheduler), ' +
    'so the existing generated client is kept. If schema.prisma changed, stop both and run `npm run generate`.'
  );
  process.exit(0);
}

process.stdout.write(output);
process.exit(result.status || 1);
