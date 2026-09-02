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
| `FRONTEND_URL` | Leave as `http://localhost:5173` |
| `SMTP_*` | See [Email](#email-gmail-smtp) below |
| `UPLOAD_DIR` | Leave as `./uploads` |

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

Open http://localhost:5173 and log in with one of the seeded staff accounts,
or register a new candidate account.

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

42 Jest tests, all against a mocked Prisma client — no database needed.
