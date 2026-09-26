# Local setup (without Docker)

`docker-compose.yml` exists in this repo but isn't wired up for local dev yet.
Until it is, run the API and frontend directly with Node — this is exactly how
local dev has been running so far. Two terminals, no containers.

## Prerequisites

- **Node.js 20+** and npm (CI runs on Node 20 — use that or newer)
- Git
- A MySQL database you can connect to (see [Database](#database) below —
  you do *not* need to install MySQL yourself if you use the shared dev DB)

## 1. Clone and install dependencies

```bash
git clone <repo-url>
cd erecruitment

cd backend && npm install
cd ../frontend && npm install
```

## 2. Environment variables

`backend/.env` is gitignored and never committed — you need your own copy.

```bash
cd backend
cp .env.example .env
```

Then fill in the values. `.env.example` has placeholders for a **local**
MySQL instance; you have two options:

**Option A — use the shared dev database (fastest, recommended)**
Ask [@M-Jude](https://github.com/M-Jude) for the working `DATABASE_URL`
(points at a shared cloud MySQL instance) and `JWT_SECRET`, sent over a
private channel (DM/1Password/etc.) — never paste real credentials into an
issue, PR, or commit. Paste the values into `backend/.env`.

**Option B — run your own local MySQL**
Install MySQL locally, create a database matching the connection string in
`.env.example` (`erec_user` / `erec_password` / db `erecruitment` on
`localhost:3306`, or your own credentials), and use that as `DATABASE_URL`.
You'll need to run migrations yourself either way — see [Database](#database).

Every other field in `.env.example` needs a real value too:

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | MySQL connection string (see above) |
| `JWT_SECRET` | Any long random string for local dev — doesn't need to match production |
| `JWT_EXPIRES_IN` | Leave as `8h` |
| `INTERNAL_EMAIL_DOMAIN` | Leave as `caa.co.ug` — determines Internal vs External candidate type |
| `PORT` | Leave as `4000` |
| `FRONTEND_URL` | Comma-separated list of allowed CORS origins. Leave as `http://localhost:5173,http://localhost:4174` (guest dev server + staff preview, see [below](#staff-access-on-a-separate-port)) |
| `SMTP_*` | See [Email](#email-gmail-smtp) below |
| `UPLOAD_DIR` | Leave as `./uploads` |
| `TRUST_PROXY` | Optional. Which reverse proxy to believe about a client's address, used by the sign-in rate limits. Default `loopback` (a proxy on the same machine, e.g. nginx or IIS). Set to `false` if nothing sits in front of the API, or to a hop count or proxy address if the proxy is on another machine |
| `APP_TIMEZONE` | Optional. Time zone used for interview times in emails and notifications. Default `Africa/Kampala` |
| `SCHEDULER_INTERVAL_MINUTES` | Optional. How often the scheduler worker runs the maintenance jobs. Default `60` |
| `DATABASE_URL_TEST` | Only for the end-to-end tests: a separate, empty MySQL database whose name contains `test`. See [Running tests](#running-tests) |

## 3. Database

Generate the Prisma client and apply migrations:

```bash
cd backend
npx prisma generate
npx prisma migrate deploy
```

`npx prisma migrate status` will tell you if the schema is already up to
date (it will be, if you're using the shared dev DB — no need to re-run
migrations against it).

**If you're using the shared dev DB, the staff accounts are already
seeded** — log in with (password for all: `ChangeMe123!`):
- `hro@caa.co.ug` — HR Officer
- `phro@caa.co.ug` — Principal HR Officer
- `dhra@caa.co.ug` — DHRA / Manager HR

Only running your own local database (Option B above)? Seed it yourself
(safe to re-run — it upserts):

```bash
npm run seed
```

## 4. Email (Gmail SMTP)

Candidate registration, password reset, and interview-panel links all send
email. For local dev this project uses a Gmail account with an **App
Password** (a regular Gmail password will not work — Google rejects it with
a `535 Bad Credentials` error).

If you're using the shared dev database, ask for the working `SMTP_USER` /
`SMTP_PASS` the same way as the DB credentials. To set up your own:

1. Enable 2-Step Verification on the Gmail account: https://myaccount.google.com/security
2. Generate an App Password: https://myaccount.google.com/apppasswords → app: "Mail"
3. Set in `backend/.env`:
   ```
   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT=587
   SMTP_USER="youraccount@gmail.com"
   SMTP_PASS="the 16-character app password"
   SMTP_FROM="UCAA e-Recruitment <youraccount@gmail.com>"
   ```

To work without a mail server, set `SMTP_HOST="json"`: emails are built
and discarded instead of sent. Leaving `SMTP_HOST` empty is reported as an
error at start-up and on the HR home page, because it means no email is
ever sent.

If SMTP is left unconfigured or wrong, `sendMail` logs the failure and
returns `null` instead of crashing the server — registration/reset flows
will still respond successfully, but no email actually arrives.

## 5. Run it

Two terminals:

```bash
# terminal 1
cd backend
npm run dev      # nodemon, http://localhost:4000

# terminal 2
cd frontend
npm run dev       # vite, http://localhost:5173
```

Check the backend is up: `curl http://localhost:4000/health` → `{"status":"ok"}`

Open http://localhost:5173 to register or log in as a candidate. Staff sign
in from a separate port — see below.

## Staff access on a separate port

`/staff/login`, `/staff/forgot-password`, and `/staff/reset-password` only
render when the app is served from the staff port (`4174` by default,
`VITE_STAFF_PORT` to change it) — `RequireStaffPort` in
`frontend/src/components/ProtectedRoute.jsx` bounces them back to `/` on
any other port, including the guest dev server on `5173`. It's the same SPA
(same build, same routes), just gated by `window.location.port`:

```bash
cd frontend
npm run build            # produces dist/, needed before either preview
npm run preview:staff    # vite preview, http://localhost:4174
```

Staff sign in at http://localhost:4174/staff/login. `FRONTEND_URL` in
`backend/.env` must list the guest origin first, then the staff origin
(`http://localhost:5173,http://localhost:4174`) — order matters, since the
backend also uses the second entry (`staffFrontendUrl` in
`backend/src/config/frontendUrl.js`) to build the links it emails staff
(new-account "set your password", "reset your password"). Getting the
order wrong doesn't break CORS, but it does send staff an email link to a
port that immediately redirects them away.

## Scheduled maintenance

Four jobs in `backend/scripts/` must run every hour. Nothing else runs
them, so they have to be started as part of every deployment:

| Script | What it does |
|---|---|
| `checkSlaEscalations.js` | Escalates an overdue VacancyApproval/DepartmentApproval/OfferApproval to the next role tier |
| `checkVacancyDeadlines.js` | Notifies a vacancy's creator once its deadline passes while still Open/PartiallyFilled |
| `cleanupPendingRegistrations.js` | Deletes abandoned candidate registrations whose confirmation link expired unused |
| `cleanupVerificationTokens.js` | Deletes email-confirmation and password-reset links that were used or expired more than 7 days ago |

**If they stop running, staff are told.** Every run is recorded in the
`SystemHealth` table. If any job hasn't succeeded in 3 hours, the HR home
page shows a warning banner to every staff member, and every Director gets
an in-app alert, at most once a day per problem. Failing email is reported
the same way.

### Recommended: the scheduler worker

One long-running process runs all four jobs every hour
(`SCHEDULER_INTERVAL_MINUTES` to change it), separately from the API:

```bash
cd backend
npm run jobs
```

Run it next to the API under whatever keeps the API running. For example,
with pm2:

```bash
pm2 start npm --name erecruitment-api -- start
pm2 start npm --name erecruitment-jobs -- run jobs
```

On Windows, register `npm run jobs` as a service with NSSM, the same way
as the API. It needs the same `backend/.env` and database access as the
API; running it on the same host is simplest.

### Alternative: cron or Task Scheduler

Each script can also be run on its own. It exits with code 1 if it fails,
and its run is recorded the same way. Use this **or** the worker, not
both, or SLA escalations could be checked twice in the same hour.

**Linux/macOS (cron)** — `crontab -e`, then:
```cron
0 * * * * cd /path/to/backend && node scripts/checkSlaEscalations.js >> /var/log/erecruitment/sla.log 2>&1
0 * * * * cd /path/to/backend && node scripts/checkVacancyDeadlines.js >> /var/log/erecruitment/deadlines.log 2>&1
0 * * * * cd /path/to/backend && node scripts/cleanupPendingRegistrations.js >> /var/log/erecruitment/cleanup.log 2>&1
0 * * * * cd /path/to/backend && node scripts/cleanupVerificationTokens.js >> /var/log/erecruitment/cleanup.log 2>&1
```

All four run hourly: the warning treats a job as stopped after 3 hours
without a successful run.

**Windows (Task Scheduler)** — one example, repeat per script:
```powershell
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "scripts\checkVacancyDeadlines.js" -WorkingDirectory "D:\CAA Work\E-Recruitment\backend"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "UCAA-CheckVacancyDeadlines" -Action $action -Trigger $trigger -Description "Notifies HR when a vacancy deadline passes"
```

Each script reads `backend/.env` (database and SMTP settings), so it must
run somewhere with that file present and network access to the database.

## Deploying to Oracle Cloud (free)

See [deploy/oracle/README.md](deploy/oracle/README.md): the whole app on one Always Free VM with Docker Compose.

## Deploying to Render

[`render.yaml`](render.yaml) is a Render Blueprint that creates four services:

| Service | What it is |
|---|---|
| `erecruitment-api` | The API (Starter plan), with a 5 GB disk at `/var/data` for uploaded CVs and letters. Before each deploy it runs `npm run db:prepare` |
| `erecruitment-jobs` | Cron job, hourly: `node scripts/scheduler.js --once` (the maintenance jobs, one cycle per run) |
| `erecruitment-web` | Candidate site (static) |
| `erecruitment-staff` | Staff site: the same SPA built with `VITE_STAFF_SITE=true`, so staff sign-in works there without the `4174` port trick |

1. **Get a MySQL 8 database.** Render doesn't offer MySQL; use a hosted one
   (Aiven, Railway, DigitalOcean, Azure/AWS, or UCAA's own server if Render
   can reach it). Start with an empty database: `db:prepare`
   (`scripts/prepareDatabase.js`) builds the schema with `prisma db push`
   and marks the existing migrations as applied, because the migration
   history can't build a database from scratch. On a database that already
   has tables it just runs `prisma migrate deploy`.
2. In Render: **New → Blueprint**, pick this repository and branch. Render
   asks for the `sync: false` values:
   - `DATABASE_URL` - the MySQL connection string.
   - `FRONTEND_URL` - `https://erecruitment-web.onrender.com,https://erecruitment-staff.onrender.com`
     (candidate site first, staff second; use the real URLs Render gives the
     two sites, or your custom domains).
   - `SMTP_*` - see [Email](#email-gmail-smtp).
   - `VITE_API_URL` on both static sites - `https://erecruitment-api.onrender.com`,
     no trailing slash.
3. If a URL came out different from the guess above, fix the variable and
   redeploy. `VITE_*` values are baked in at build time, so changing them
   needs a new build of that site.
4. **Seed the staff accounts once.** From the API service's Shell tab:
   `npm run seed`. Then sign in on the staff site and change the
   `ChangeMe123!` passwords straight away.

Notes:

- The disk is what keeps uploaded files across deploys. A service with a
  disk can't run more than one instance, and deploys have a few seconds of
  downtime.
- `TRUST_PROXY` is set to `true` so the sign-in rate limits see the
  client's address behind Render's proxies.
- `JWT_SECRET` is generated by Render and copied to the cron job.

## Common issues

- **`EADDRINUSE` on port 4000** — a previous `npm run dev` is still running
  (nodemon doesn't watch `.env`, so editing it won't auto-restart the
  server). Find and stop the old process before starting a new one:
  ```bash
  # find the PID listening on 4000, then stop it
  netstat -ano | findstr :4000        # Windows
  lsof -i :4000                       # macOS/Linux
  ```
- **`535 Bad Credentials` from Gmail** — you're using a regular account
  password, not an App Password. See [Email](#email-gmail-smtp) above.
- **`getaddrinfo ENOTFOUND` / DNS errors from nodemailer** — `SMTP_HOST` is
  still a placeholder (e.g. `smtp.example.com`). Fill in real SMTP values.

## Running tests

```bash
cd backend
npm test
```

Unit tests, all against a mocked Prisma client — no database needed.

### End-to-end tests

These drive the real API against a real MySQL database: the whole
recruitment flow, simultaneous offer acceptances, the maintenance jobs,
the system-health warnings and the sign-in rate limits. They need an
**empty database of their own, whose name contains `test`**, because every
test deletes all of its data:

```bash
mysql -u root -p -e "CREATE DATABASE erecruitment_test"
cd backend
DATABASE_URL_TEST="mysql://user:password@localhost:3306/erecruitment_test" npm run test:e2e
```

The suite rebuilds the database from `schema.prisma` before each run and
refuses to touch a database without `test` in its name. CI runs it against
a MySQL 8 service container. See `backend/tests-e2e/README.md`.
