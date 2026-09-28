// `npm run dev`: the API (under nodemon, restarting on code changes) and the
// scheduler worker (scripts/scheduler.js) side by side in one terminal, each
// line prefixed [api] / [jobs]. They're still two separate processes - the
// scheduler never runs inside the API process (see scheduler.js's header).
//
// The scheduler is deliberately NOT under nodemon: it runs every job at
// start-up, so restarting it on each file save would re-send reminders and
// re-check escalations every time you edit code. Restart `npm run dev` to
// pick up changes to the jobs themselves.
//
// `npm run dev:api` runs the API alone. Ctrl+C stops both.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const cwd = path.join(__dirname, '..');
const COLORS = { api: '\x1b[36m', jobs: '\x1b[35m' };
const RESET = '\x1b[0m';
const children = [];
let stopping = false;

function prefixLines(stream, name, out) {
  const label = `${COLORS[name]}[${name}]${RESET} `;
  readline.createInterface({ input: stream }).on('line', (line) => out.write(`${label}${line}\n`));
}

function start(name, command) {
  // Piped output loses colour by default; keep it unless the user opted out.
  const env = process.env.NO_COLOR ? process.env : { ...process.env, FORCE_COLOR: '1' };
  const child = spawn(command, { cwd, shell: true, env });
  prefixLines(child.stdout, name, process.stdout);
  prefixLines(child.stderr, name, process.stderr);
  child.on('exit', (code) => {
    if (stopping) return;
    if (name === 'api') {
      // nodemon itself only exits on Ctrl+C or a fatal error - either way
      // there's nothing left worth keeping the scheduler up for.
      console.error(`[dev] API process exited (code ${code}) - stopping the scheduler too.`);
      stopAll(code || 0);
    } else {
      console.error(`[dev] Scheduler exited (code ${code}). The API keeps running; restart \`npm run dev\` to bring the jobs back.`);
    }
  });
  children.push(child);
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // With shell: true the direct child is the shell; on Windows only a
    // tree kill reaches the node process underneath it.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

start('api', 'npx nodemon src/server.js');
start('jobs', 'node scripts/scheduler.js');
