# Test (UAT) deployment on the office network

Runs the whole system on one Windows server for user acceptance testing,
reachable from UCAA's network only:

| Site | Address | Who |
|---|---|---|
| Careers (external candidates) | `https://<host>:5173` | Register with email and password |
| Internal Careers | `https://<host>:4175` | UCAA employees, **Sign in with Microsoft** |
| HR staff | `https://<host>:4174/staff/login` | HR testers, **Sign in with Microsoft** |

`<host>` is the server's name on the network (for example
`ark-atams.caa.co.ug`), the same in every address.

## How it fits together

- **Its own folder.** The test copy lives in its own folder (a git worktree,
  e.g. `E:\eRecruitment-UAT`) with its own `backend\.env` and `frontend\.env`.
  Development on the same machine doesn't change what testers see until
  someone runs `update-uat.ps1` there.
- **Its own database and uploads.** A database on the server's MySQL (not the
  shared development one), and uploaded files under
  `C:\ProgramData\UCAA-eRecruitment-UAT\uploads`.
- **HTTPS on every site.** Microsoft sign-in only works on https pages and
  only redirects to https addresses. `vite preview` serves the one frontend
  build on the three ports with the certificate from `new-certificate.ps1`.
- **The API isn't exposed.** It listens on port 4100 and is reached only
  through the three sites, which forward `/api` and `/ws` to it (built with
  `VITE_API_URL=same-origin`; `PREVIEW_API_TARGET` in `frontend\vite.config.js`).
  The firewall opens 5173, 4174 and 4175 only.
- **Kept running.** The scheduled task `UCAA e-Recruitment UAT` runs
  `run-uat.ps1` as SYSTEM from boot. It starts the API, the scheduler worker
  and the three sites, and restarts any that stop.
- **Production mode.** `NODE_ENV=production`: no demo password sign-in;
  staff sign in with Microsoft only.

## Setting it up

1. **Deployment folder**, from the development copy:
   ```powershell
   git worktree add E:\eRecruitment-UAT <branch>
   ```
2. **Database.** On the server's MySQL, create an empty database and a user
   for it:
   ```sql
   CREATE DATABASE erecruitment_uat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'erec_uat'@'localhost' IDENTIFIED BY '<password>';
   GRANT ALL PRIVILEGES ON erecruitment_uat.* TO 'erec_uat'@'localhost';
   ```
3. **Certificate** (no admin needed):
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\lan\new-certificate.ps1 -HostNames <host> -IpAddresses <server IP>
   ```
4. **`backend\.env`** in the deployment folder - like the development one
   (SETUP.md), except:
   ```ini
   NODE_ENV=production
   PORT=4100
   DATABASE_URL="mysql://erec_uat:<password>@localhost:<mysql port>/erecruitment_uat"
   FRONTEND_URL="https://<host>:5173,https://<host>:4174,https://<host>:4175"
   UPLOAD_DIR="C:\ProgramData\UCAA-eRecruitment-UAT\uploads"
   TRUST_PROXY=loopback
   JWT_SECRET=<a new long random string, not the development one>
   ```
   No `DEV_PASSWORD_LOGIN`. `FRONTEND_URL` order matters: careers, staff,
   Internal Careers (links in emails are built from it).
5. **`frontend\.env`** in the deployment folder:
   ```ini
   VITE_API_URL=same-origin
   VITE_ENTRA_TENANT_ID=...
   VITE_ENTRA_STAFF_CLIENT_ID=...
   VITE_ENTRA_CANDIDATE_CLIENT_ID=...
   PREVIEW_API_TARGET=http://127.0.0.1:4100
   PREVIEW_TLS_PFX=C:\ProgramData\UCAA-eRecruitment-UAT\tls\uat-tls.pfx
   PREVIEW_TLS_PASSPHRASE=<printed by new-certificate.ps1>
   PREVIEW_ALLOWED_HOSTS=<host>
   ```
6. **Build and create the schema:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\lan\update-uat.ps1 -NoPull
   ```
   On the empty database this creates every table and marks the existing
   migrations as applied (`backend\scripts\prepareDatabase.js`).
7. **Reference data and the first administrator**, from `backend\`:
   ```powershell
   node scripts/seedDepartments.js
   node scripts/seedSlaPolicies.js
   node scripts/createSystemAdmin.js --email firstname.lastname@caa.co.ug --name "Full Name" --department ICT
   ```
8. **Microsoft sign-in redirect addresses.** The Entra administrator adds, as
   *Single-page application* redirect URIs:
   - staff app: `https://<host>:4174/entra-redirect.html`
   - candidate app: `https://<host>:4175/entra-redirect.html`
9. **Install** (administrator PowerShell, once):
   ```powershell
   powershell -ExecutionPolicy Bypass -File E:\eRecruitment-UAT\deploy\lan\install-uat.ps1 -Operator CAA\<your account>
   ```
10. **Testers' PCs trust the certificate.** Until they do, browsers show a
    "not secure" warning that each tester has to click through on each of
    the three addresses. IT can push `uat-tls.cer` to *Trusted Root
    Certification Authorities* by group policy, or replace the certificate
    with one from UCAA's certificate authority (same file, same settings).

## Checking it works

- `https://<host>:5173` shows the job list.
- `https://<host>:4174/staff/login`: the administrator signs in with
  Microsoft and lands on **Staff accounts**.
- On the HR home page, no system-health warnings a few minutes after start.
- From another PC on the network, all three addresses open.

Then the administrator creates the testers' staff accounts and someone adds
positions - see "Before testers start" in [docs/database-reset.md](../../docs/database-reset.md).

## Day to day

| To | Do |
|---|---|
| Deploy new code | In the deployment folder: `powershell -ExecutionPolicy Bypass -File deploy\lan\update-uat.ps1`. Pulls its branch, migrates, rebuilds, restarts; a few minutes' outage |
| Restart everything | Create an empty file `deploy\lan\logs\restart` |
| Stop it for a while | Create `deploy\lan\logs\hold`; delete it to start again |
| See what happened | `deploy\lan\logs\supervisor.log`, and `<process>-<date>.out.log` / `.err.log` for `api`, `jobs`, `external`, `staff`, `internal` |
| Start over with an empty system | [docs/database-reset.md](../../docs/database-reset.md), from the deployment folder |

Development servers on the same machine (`npm run dev`, `npm run preview:staff`
…) can't run while the test deployment is up: they use the same ports.

## Troubleshooting

- **A site doesn't open from another PC, but does on the server**: the
  firewall rule is missing (re-run `install-uat.ps1`), or the PC isn't on
  the UCAA network.
- **"Blocked request. This host is not allowed"**: the address used isn't in
  `PREVIEW_ALLOWED_HOSTS`. Add it (comma-separated) and restart.
- **Microsoft sign-in says the redirect URI doesn't match**: step 8 - the
  address, with its port, must be registered exactly.
- **"Microsoft sign-in has not been set up for this site yet"**: the
  `VITE_ENTRA_*` values weren't in `frontend\.env` when it was built. Add them
  and run `update-uat.ps1 -NoPull`.
- **Every site shows "Server offline"**: the API isn't running - see
  `logs\api-<date>.err.log`. Usually the database: is MySQL running?
