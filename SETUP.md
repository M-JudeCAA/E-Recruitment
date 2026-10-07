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
| `INTERNAL_EMAIL_DOMAIN` | Leave as `caa.co.ug` (comma-separate several). Only accounts on it can sign in with Microsoft, and it can't be used to register a password account |
| `ENTRA_TENANT_ID`, `ENTRA_STAFF_CLIENT_ID`, `ENTRA_CANDIDATE_CLIENT_ID` | Microsoft sign-in - see [Microsoft (Entra ID) sign-in](#microsoft-entra-id-sign-in). Without them the API says so at start-up and Microsoft sign-in answers 501 |
| `DEV_PASSWORD_LOGIN` | Optional, local development only: `true` lets the seeded demo staff accounts sign in with their password at `/staff/login?password`. Ignored when `NODE_ENV=production` |
| `BREAK_GLASS_LOGIN` | Optional, production emergencies only: `true` lets a system administrator with a break-glass password sign in at `/staff/login?password` while Microsoft sign-in is down. Leave unset otherwise |
| `PORT` | Leave as `4000` |
| `FRONTEND_URL` | Comma-separated list of allowed CORS origins. Leave as `http://localhost:5173,http://localhost:4174,http://localhost:4175` (guest dev server, staff preview, Internal Careers preview - see [below](#staff-access-on-a-separate-port)) |
| `SMTP_*` | See [Email](#email-gmail-smtp) below |
| `UPLOAD_DIR` | Leave as `./uploads` |
| `ACCESS_LOG_RETENTION_DAYS` | Optional. How long the record of who viewed candidate data is kept before the scheduled job deletes it (default `730`, minimum `90`). Once set on the Settings & data page (`/hr/settings`), the page's value wins |
| `TRUST_PROXY` | Optional. Which reverse proxy to believe about a client's address, used by the sign-in rate limits. Default `loopback` (a proxy on the same machine, e.g. nginx or IIS). Set to `false` if nothing sits in front of the API, or to a hop count or proxy address if the proxy is on another machine |
| `APP_TIMEZONE` | Optional. Time zone used for interview times in emails, notifications and calendar invitations. Default `Africa/Kampala` |
| `INTERVIEW_ORGANIZER_EMAIL` | Optional but recommended. The mailbox shown as the organizer of interview calendar invitations - when a panelist or candidate accepts or declines, the reply goes here (e.g. the HR recruitment mailbox). Default: the address in `SMTP_FROM` |
| `HRIS_HANDOFF_URL`, `HRIS_HANDOFF_TOKEN` | Optional, for when the core HRIS can take new hires. "Mark as Hired" POSTs each onboarding case there as JSON (with the case reference as the `Idempotency-Key` header, and the token as a bearer token), retrying until it is accepted. Unset: HR downloads each case's package and passes it on by hand |
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

Staff sign in with their UCAA Microsoft account. For local development
without an Entra tenant, seed the demo staff accounts (safe to re-run — it
upserts; refused when `NODE_ENV=production`) and set
`DEV_PASSWORD_LOGIN=true` in `backend/.env`:

```bash
npm run seed
```

Then sign in at http://localhost:4174/staff/login?password with
(password for all: `ChangeMe123!`):
- `hro@caa.co.ug` — HR Officer
- `shro@caa.co.ug` — Senior HR Officer
- `phro@caa.co.ug` — Principal HR Officer
- `manager@caa.co.ug` — Manager
- `dhra@caa.co.ug` — DHRA / Director
- `admin@caa.co.ug` — system administrator (staff accounts only, no HR role)

In production there are no staff passwords: create the first system
administrator on the server, and they create everyone else from the Staff
accounts screen:

```bash
node scripts/createSystemAdmin.js --email it.admin@caa.co.ug --name "IT Administrator" [--department ICT] [--break-glass]
```

`--break-glass` also gives that account an emergency password (printed
once - keep it sealed), usable only while `BREAK_GLASS_LOGIN=true`.

## Microsoft (Entra ID) sign-in

Staff and internal candidates sign in with their UCAA Microsoft account;
external candidates keep email + password. Entra only proves who someone
is — it has no notion of "HR staff" here, so **every UCAA employee can get
past Microsoft, and that's fine**: the API lets someone into the staff
portal only if a system administrator created an active staff account for
their email, and gives them the role on that account. Any employee,
HR staff included, can sign in on the candidate site to apply for a job (a
separate candidate session); once a staff member applies for a vacancy they
are shut out of running it (`conflictOfInterestService.js`).

Have the Entra administrator create **two app registrations** in Entra
admin centre → App registrations → New registration (single tenant):

| | Staff app | Candidate app |
|---|---|---|
| Name | UCAA e-Recruitment (staff) | UCAA e-Recruitment (candidates) |
| Platform | Single-page application | Single-page application |
| Redirect URI | `https://<staff host>/entra-redirect.html` (and `http://localhost:4174/entra-redirect.html` for dev) | `https://<Internal Careers host>/entra-redirect.html` (and `http://localhost:4175/entra-redirect.html` for dev) - employees sign in on Internal Careers only |
| API permissions | Microsoft Graph `openid`, `profile`, `email` (delegated; the defaults) | same |
| Token configuration (optional claims, ID token) | `email`, `acct` | `email`, `acct` |
| Enterprise application → Properties → Assignment required | **Yes**, then assign a security group (e.g. "e-Recruitment Staff") — optional extra layer, the staff account list is still what decides | No — every employee may apply |

Then set the IDs:

- `backend/.env`: `ENTRA_TENANT_ID`, `ENTRA_STAFF_CLIENT_ID`, `ENTRA_CANDIDATE_CLIENT_ID`
- `frontend/.env` (read at build time): `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_STAFF_CLIENT_ID`, `VITE_ENTRA_CANDIDATE_CLIENT_ID`

**Staff directory (picking a vacancy's hiring manager).** The New Listing
page searches UCAA staff in Entra with the signed-in HR user's own
permission: give the **staff app** the Microsoft Graph delegated permission
`User.Read.All` (or at least `User.ReadBasic.All`) with admin consent. Nothing
else is needed - the browser asks Microsoft for the token, and HR may see a
one-time Microsoft prompt. Optionally, the API can search with its own
application permission instead (`User.Read.All`, application type, plus a
client secret in `ENTRA_DIRECTORY_CLIENT_SECRET`, and
`ENTRA_DIRECTORY_CLIENT_ID` if it isn't the staff app). If neither works, HR
types the hiring manager's name and UCAA email. The Staff accounts screen
uses the same search for the system administrator's "Full name" field.

**Staff app users waiting for a role.** The Staff accounts screen lists the
people assigned to the staff app in Entra (Enterprise applications > the
staff app > Users and groups, directly or through a group) who have no staff
account yet; the system administrator picks a role and the account is made.
This is read by the API with the directory connection above
(`ENTRA_DIRECTORY_CLIENT_SECRET`), and needs two more Microsoft Graph
**application** permissions with admin consent: `Application.Read.All` (the
app's assignments) and `GroupMember.Read.All` (members of an assigned group).
Without them the list says so, and accounts are created by name as before.
Assigning someone in Entra gives them no access by itself - only the role
given here does.

Create staff accounts with the person's **sign-in name** (UPN) — that is
what Entra reports when the `email` claim is empty. The first sign-in links
the account to the person's Microsoft object id; from then on only that id
counts. If someone's Microsoft account is deleted and recreated, a system
administrator uses **Unlink** on the Staff accounts screen so it links again.

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
npm run dev      # API (nodemon, http://localhost:4000) + scheduler worker

# terminal 2
cd frontend
npm run dev       # vite, http://localhost:5173
```

Check the backend is up: `curl http://localhost:4000/health` → `{"status":"ok"}`

The backend's `npm run dev` starts two processes in one terminal, their
output prefixed `[api]` and `[jobs]`: the API under nodemon, and the
scheduler worker (see [Scheduled maintenance](#scheduled-maintenance)).
The worker isn't restarted on file changes, since it runs every job at
start-up; restart `npm run dev` after editing a job. Ctrl+C stops both.
Use `npm run dev:api` for the API alone, e.g. while a separate
`npm run jobs` is already running (don't run two workers at once).

Open http://localhost:5173 to register or log in as a candidate. Staff sign
in from a separate port — see below.

## Staff access on a separate port

`/staff/login` only renders when the app is served from the staff port (`4174` by default,
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
(the new-account email). Getting the
order wrong doesn't break CORS, but it does send staff an email link to a
port that immediately redirects them away.

## Internal Careers on its own port

UCAA employees apply on **Internal Careers** - the same build served on its
own port (`4175` by default, `VITE_INTERNAL_PORT` to change it;
`frontend/src/internalPort.js`). There, sign-in is Microsoft only (no
password, registration or forgotten password), only Internal vacancies are
listed, and the pages live under `/careers`. Every other path on that port
goes to `/careers`, and `/careers` pages on any other port go to `/`. The
public careers site keeps email and password for external applicants and
links UCAA staff to Internal Careers instead of offering Microsoft sign-in.

```bash
cd frontend
npm run build
npm run preview:internal   # vite preview, http://localhost:4175
```

Before it works:

- **Entra:** add `https://<Internal Careers host>/entra-redirect.html` (and
  `http://localhost:4175/entra-redirect.html` for dev) to the **candidate** app
  registration's redirect URIs. Without it Microsoft refuses the sign-in.
- **API:** add the Internal Careers origin to `FRONTEND_URL` (third entry is
  fine - the first two keep their meaning).
- **Links between the sites:** when they have their own host names, set
  `VITE_INTERNAL_SITE_URL` (where the public site sends UCAA staff) and
  `VITE_PUBLIC_SITE_URL` (where Internal Careers sends non-employees) at
  build time. Without them the same host is assumed (the public site on
  `5173` when running locally).
- **Directory details (optional):** on first sign-in the employment form is
  filled from the employee's Microsoft profile (`/me` and `/me/manager` with
  the default `User.Read` permission) where the directory has job title,
  department, employee ID or manager. Nothing is needed for this; where the
  directory is empty the employee types the details in.
- **Picking the supervisor:** the Supervisor field suggests UCAA staff from
  the directory as the employee types, and picking one fills the name and the
  email (the email can't be typed while the directory works, and the API
  refuses a supervisor email outside `INTERNAL_EMAIL_DOMAIN`). The browser
  searches with the employee's own session: give the **candidate** app
  registration the delegated Microsoft Graph permission **User.ReadBasic.All**
  and grant admin consent for the organisation (the search never opens a
  consent window). Failing that it uses the API's directory connection
  (`ENTRA_DIRECTORY_CLIENT_SECRET`, above). With neither, the employee types
  the name and UCAA email.

## Scheduled maintenance

Eight jobs in `backend/scripts/` must run every hour. Nothing else runs
them, so they have to be started as part of every deployment:

| Script | What it does |
|---|---|
| `checkSlaEscalations.js` | Escalates an overdue vacancy, directorate, department, position or offer approval to the next role tier |
| `checkVacancyDeadlines.js` | Notifies a vacancy's creator once its deadline passes while still Open/PartiallyFilled |
| `sendInterviewReminders.js` | Reminds candidates and panelists about an interview a day ahead, and reminds HR when an interview's results haven't been recorded a day after it |
| `expireOffers.js` | Reminds a candidate two days before their offer's response deadline, and expires offers past it |
| `cleanupPendingRegistrations.js` | Deletes abandoned candidate registrations whose confirmation link expired unused |
| `cleanupVerificationTokens.js` | Deletes email-confirmation and password-reset links that were used or expired more than 7 days ago |
| `cleanupRequisitionUploads.js` | Deletes uploaded requisitions (and their signed scans) that no vacancy or draft uses, after 24 hours |
| `purgeAccessLog.js` | Deletes the record of who viewed candidate data once it is older than the retention set on the Settings & data page (else `ACCESS_LOG_RETENTION_DAYS`) |
| `retryHrisHandoffs.js` | Re-sends onboarding cases the HRIS hasn't accepted yet (only with `HRIS_HANDOFF_URL` set); after six failed tries the Directors are alerted |
| `purgeCandidateData.js` | Erases the personal data of candidates with no activity for the retention period set on the Settings & data page (default 24 months); hired candidates and anyone with an application in progress are never erased |

**If they stop running, staff are told.** Every run is recorded in the
`SystemHealth` table. If any job hasn't succeeded in 3 hours, the HR home
page shows a warning banner to every staff member, and every Director gets
an in-app alert, at most once a day per problem. Failing email is reported
the same way.

### Recommended: the scheduler worker

One long-running process runs all the jobs every hour
(`SCHEDULER_INTERVAL_MINUTES` to change it), separately from the API:

```bash
cd backend
npm run jobs
```

Locally, `npm run dev` already starts it next to the API. In production,
run it next to the API under whatever keeps the API running. For example,
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
0 * * * * cd /path/to/backend && node scripts/sendInterviewReminders.js >> /var/log/erecruitment/interviews.log 2>&1
0 * * * * cd /path/to/backend && node scripts/expireOffers.js >> /var/log/erecruitment/offers.log 2>&1
0 * * * * cd /path/to/backend && node scripts/cleanupRequisitionUploads.js >> /var/log/erecruitment/cleanup.log 2>&1
0 * * * * cd /path/to/backend && node scripts/purgeAccessLog.js >> /var/log/erecruitment/cleanup.log 2>&1
0 * * * * cd /path/to/backend && node scripts/purgeCandidateData.js >> /var/log/erecruitment/cleanup.log 2>&1
0 * * * * cd /path/to/backend && node scripts/retryHrisHandoffs.js >> /var/log/erecruitment/cleanup.log 2>&1
```

All of them run hourly: the warning treats a job as stopped after 3 hours
without a successful run.

**Windows (Task Scheduler)** — one example, repeat per script:
```powershell
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "scripts\checkVacancyDeadlines.js" -WorkingDirectory "D:\CAA Work\E-Recruitment\backend"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "UCAA-CheckVacancyDeadlines" -Action $action -Trigger $trigger -Description "Notifies HR when a vacancy deadline passes"
```

Each script reads `backend/.env` (database and SMTP settings), so it must
run somewhere with that file present and network access to the database.

## Test (UAT) deployment on the office network

See [deploy/lan/README.md](deploy/lan/README.md): the whole system on one
Windows server for user testing, over HTTPS - careers on the standard port (443), 4174
(HR staff) and 4175 (Internal Careers), from its own folder, database and
upload directory, kept running by a scheduled task.

## Resetting the database

To empty a database for a fresh round of testing (recruitment data, uploaded
files and, optionally, the demo staff accounts), follow
[docs/database-reset.md](docs/database-reset.md). It covers the backup, the
dry run, the reset itself (`backend/scripts/resetDemoData.js`) and what to set
up before testers start.

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
