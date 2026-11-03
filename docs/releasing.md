# Production: setting it up and releasing

Production runs on two servers:

| Server | Runs |
|---|---|
| **App server** (Windows Server) | The API, the scheduler worker and the three sites (careers, HR staff `:4174`, Internal Careers `:4175`), the same way as the test (UAT) server - the [deploy/lan](../deploy/lan/README.md) scripts. Uploaded files and backups are kept here. |
| **Database server** | MySQL 8, holding the production database only. Reached from the app server alone. |

## Branches

| Branch | Goes to | How |
|---|---|---|
| `main` | Test (UAT) server | Every change, by pull request. Live for testers within ~5 minutes of CI passing. |
| `release` | Production | Only from `main`, by a pull request, once testers have signed off what is on UAT. |

```
feature/... --PR--> main --(UAT, testers sign off)--PR--> release --CI passes--> tag vYYYY.MM.DD --> production
```

- **Every release is tagged.** When a push to `release` passes CI (unit tests,
  end-to-end tests, the frontend build), the `tag-release` job in
  `.github/workflows/ci.yml` tags that commit `vYYYY.MM.DD` (Kampala date;
  `v2026.11.03.2` for a second release the same day) and publishes a GitHub
  Release listing the pull requests since the previous tag. A commit that fails
  CI gets no tag and is never deployed, so every version production has run
  has a tag.
- **The production server pulls it.** Every 5 minutes it asks GitHub for the
  newest `release` commit whose CI run passed and deploys it: the database is
  backed up, the schema updated, the sites rebuilt and swapped in. Users are
  cut off for a few minutes, so merge a release out of working hours.

### GitHub settings (once, by a repository administrator)

Settings > Branches > add a rule (or ruleset) for `release`:

- Require a pull request before merging (at least one approval).
- Require status checks to pass: `backend`, `backend-e2e`, `frontend`.
- Block force pushes and deletion.
- Allow merge commits for it. A release must be a **merge commit**, not a squash
  or rebase, so `main` and `release` keep the same history and the next
  release merges cleanly.

Settings > Actions > General > Workflow permissions can stay read-only: the
workflow grants `contents: write` to the tagging job alone.

## Releasing

1. Check that what you want released is on UAT and has been tested there.
2. On GitHub: **New pull request**, base `release`, compare `main`. The
   description lists what is going out (the GitHub Release lists it again from
   the merged PRs).
3. Look for new migrations (`backend/prisma/migrations/`). They run against
   production as part of the deployment. Large ones go out of hours.
4. Merge it with **Create a merge commit**.
5. Watch the Actions run. When it passes, the tag and the GitHub Release
   appear (`tag-release` job).
6. Within 5 minutes the server deploys it. On the app server,
   `deploy\lan\logs\deploy.log` shows `deploying v2026.11.03 (abc1234) ...` and
   then `deployed v2026.11.03`. `deploy\lan\logs\deployed.json` holds the live
   tag.
7. Check that the sites open, an HR user can sign in, and
   `http://127.0.0.1:4100/health/ready` on the app server answers
   `{"status":"ok","database":"ok"}`.

### A fix that can't wait for main

1. Branch from `release` (`hotfix/...`), fix it, open a PR into `release`.
2. Once it is released, open a PR from `release` into `main` (or cherry-pick the
   fix onto `main`), so the next release doesn't undo it.

### If a release goes wrong

If a deployment **fails** (install, schema, build), the server puts the
previous commit back on its own, and `deploy.log` says so. That brings back
the code, not the database. If the failed release had already changed the
schema, restore the dump taken just before it (below).

To go back to an earlier release by hand, on the app server, in the
deployment folder:

```powershell
New-Item -ItemType File deploy\lan\logs\no-auto-deploy     # pause automatic deployment
powershell -ExecutionPolicy Bypass -File deploy\lan\update-uat.ps1 -Commit v2026.10.28
```

Then fix the problem on `main` and release again. Delete `no-auto-deploy` once
the fixed release is merged into `release`; the server won't deploy a commit
older than what is live.

## Backups

`deploy\lan\backup.ps1` runs on the app server:

- **nightly at 01:30** (task `UCAA e-Recruitment Production backup`), and
- **before every deployment**, before the schema is touched. If that backup
  fails, the deployment stops and nothing changes.

Each run writes `<BackupDir>\db\erecruitment-<date>-<label>.sql.gz`, a
consistent `mysqldump` of the whole database taken over the same TLS
connection the API uses, and mirrors `UPLOAD_DIR` to
`<BackupDir>\uploads`. The mirror drops files the system deleted (for
example, a candidate's data erased on request), so a backup never keeps
what the system was asked to forget. Dumps older than `BackupKeepDays`
(30) are deleted. Each run is logged in `deploy\lan\logs\backup.log`.

These copies are on the app server. **ICT should also copy `BackupDir` off the
server** with the usual server backup, and keep MySQL's own backups on the
database server. Try a restore into a scratch database now and then.

### Restoring the database

Stop the app first, so nothing writes while you restore:

```powershell
New-Item -ItemType File deploy\lan\logs\no-auto-deploy
New-Item -ItemType File deploy\lan\logs\hold     # the app stops within seconds
```

Unpack the dump:

```powershell
$gz = 'D:\UCAA-eRecruitment\backups\db\erecruitment-20261103-013000-daily.sql.gz'
$sql = $gz -replace '\.gz$', ''
$in = [IO.File]::OpenRead($gz); $out = [IO.File]::Create($sql)
$z = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
$z.CopyTo($out); $z.Dispose(); $out.Dispose(); $in.Dispose()
```

On the database server, the DBA empties the database
(`DROP DATABASE erecruitment; CREATE DATABASE erecruitment CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
so that tables added by a later release go too. Then load the dump:

```powershell
mysql --host=<database server> --user=<admin user> -p --ssl-mode=REQUIRED erecruitment --execute="source $($sql -replace '\\','/')"
```

Put back the code that matches the dump (`update-uat.ps1 -Commit <tag before it>`,
which also lets the app start again), then delete `hold` (if it is still there)
and `no-auto-deploy`. Delete the unpacked `.sql` file afterwards: it holds
personal data.

## Setting up production (once)

### Database server

1. MySQL 8.0 or later, with TLS on (MySQL 8 makes a certificate on its own; a
   certificate from UCAA's CA is better, so the app server can verify it).
2. The database, and a user that can only come from the app server and only
   over TLS:
   ```sql
   CREATE DATABASE erecruitment CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'erec'@'<app server IP>' IDENTIFIED BY '<long random password>' REQUIRE SSL;
   GRANT ALL PRIVILEGES ON erecruitment.* TO 'erec'@'<app server IP>';
   ```
   The app needs full rights on its own database (migrations create and alter
   tables). It needs nothing outside it.
3. Firewall: port 3306 open to the app server only.
4. The DBA's own backups (binary logs or nightly dumps) as for any production
   database.

### App server

1. **Software:** Node.js 20 LTS (what CI tests with), Git for all users
   (`winget install --id Git.Git --scope machine`), and the MySQL 8 client
   tools, for `mysqldump`/`mysql` (MySQL Installer, "MySQL Shell/Client" only,
   no server).
2. **Deployment folder:** its own clone, on the `release` branch:
   ```powershell
   git clone --branch release https://github.com/M-JudeCAA/E-Recruitment.git D:\eRecruitment
   ```
3. **Which deployment this is:** copy
   `deploy\lan\environment.production.example.json` to
   `deploy\lan\environment.json` and adjust `DataDir` (uploads, certificate and
   backups go under it). This file is what makes the scripts deploy `release`,
   name the tasks "... Production", back up, and take port 443 on every address.
   It isn't in git, so a deployment never overwrites it.
4. **Database CA certificate:** copy the database server's CA certificate (PEM)
   to `<DataDir>\tls\mysql-ca.pem`.
5. **Site certificate:** preferably one from UCAA's certificate authority for
   the production host name, as a .pfx in `<DataDir>\tls\`. Until then
   `deploy\lan\new-certificate.ps1 -HostNames <host> -IpAddresses <IP> -OutDir <DataDir>\tls`
   makes a self-signed one.
6. **`backend\.env`:** as for UAT ([deploy/lan/README.md](../deploy/lan/README.md),
   step 4), with production values:
   ```ini
   NODE_ENV=production
   PORT=4100
   HOST=127.0.0.1
   DATABASE_URL="mysql://erec:<password>@<database server>:3306/erecruitment?sslaccept=strict&sslcert=D:/UCAA-eRecruitment/tls/mysql-ca.pem"
   FRONTEND_URL="https://<host>,https://<host>:4174,https://<host>:4175"
   UPLOAD_DIR="D:\UCAA-eRecruitment\uploads"
   TRUST_PROXY=loopback
   JWT_SECRET=<new, 64 random characters - never UAT's>
   INTERNAL_EMAIL_DOMAIN=caa.co.ug
   SMTP_HOST=...            # and the other SMTP_* values
   ENTRA_TENANT_ID=...      # and ENTRA_STAFF_CLIENT_ID / ENTRA_CANDIDATE_CLIENT_ID
   ```
   URL-encode any `@ : / ? # &` in the password. `sslaccept=strict` with
   `sslcert` makes the API check the database server's certificate. Without
   `sslcert` the API warns at start-up that the connection may not be
   encrypted. No `DEV_PASSWORD_LOGIN`, and no `BREAK_GLASS_LOGIN` unless it's
   needed.

   **The API and the scheduler refuse to start in production** when
   `JWT_SECRET` is under 32 characters, or `DATABASE_URL`, `FRONTEND_URL`,
   `UPLOAD_DIR` or `INTERNAL_EMAIL_DOMAIN` is missing, or a `FRONTEND_URL`
   address isn't https. The reason is in `deploy\lan\logs\api-<date>.err.log`.
7. **`frontend\.env`:** as for UAT (step 5 there), with the production host,
   certificate and Entra values.
8. **Install, build, create the schema:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\lan\update-uat.ps1 -NoPull
   ```
   This also tests the backup: it dumps the (still empty) database first.
9. **Reference data and the first administrator**, from `backend\`:
   ```powershell
   node scripts/seedDepartments.js
   node scripts/seedSlaPolicies.js
   node scripts/createSystemAdmin.js --email firstname.lastname@caa.co.ug --name "Full Name" --department ICT
   ```
   Never `npm run seed` or the demo seeders. They refuse in production anyway.
10. **Microsoft sign-in:** the Entra administrator adds the production redirect
    URIs (`https://<host>:4174/entra-redirect.html` on the staff app,
    `https://<host>:4175/entra-redirect.html` on the candidate app), and the
    staff app's group if it's used (`ENTRA_STAFF_GROUP_ID`,
    [entra-staff-group-setup.md](entra-staff-group-setup.md)).
11. **Scheduled tasks and firewall** (administrator PowerShell):
    ```powershell
    powershell -ExecutionPolicy Bypass -File D:\eRecruitment\deploy\lan\install-uat.ps1 -Operator CAA\<operator account>
    ```
    This registers `UCAA e-Recruitment Production` (keeps it running),
    `... Production deploy` (every 5 minutes) and `... Production backup`
    (nightly), and opens 443, 80, 4174 and 4175.
12. **DNS:** the production host name points at the app server.

Then check it as in "Releasing", step 7.

## How UAT and production differ

| | UAT | Production |
|---|---|---|
| Deploys | `main` | `release` (tagged) |
| `deploy\lan\environment.json` | none (the defaults) | from `environment.production.example.json` |
| Database | same server | database server, over TLS |
| Backups | none | nightly and before each deployment |
| Careers site on 443 | office address only (Tailscale) | every address |
| Scheduled tasks | `UCAA e-Recruitment UAT ...` | `UCAA e-Recruitment Production ...` |
| Reset scripts | `--yes` | `--yes --production` (demo seeders refused) |
