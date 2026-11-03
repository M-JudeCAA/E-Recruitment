# Production: install, publish, release

The runbook kept with the code for UCAA's production e-Recruitment system:
Phases 4, 5 and 12 of the *e-Recruitment Production Deployment Plan (no DMZ)*,
plus how a release reaches production. The plan has the rest: the requests to
raise (Phase 1), building the Ubuntu app server and the Windows database server
(Phases 2 and 3), Microsoft 365 mail, Entra and Conditional Access
(Phases 6 to 8), reference data (Phase 10) and testing (Phase 11).

| Machine | Runs |
|---|---|
| `erecruit-app01`, Ubuntu Server 24.04 | nginx with the certificate, the WAF (ModSecurity + OWASP CRS) and rate limits for all three sites; the API and the scheduler as systemd services; the built site; uploads |
| `ERECRUIT-DB01`, Windows Server 2022 | MySQL 8.4, reachable from the app server only |

| Site | Host name | Stamp nginx sets |
|---|---|---|
| Public careers | careers.caa.co.ug | `public` |
| HR workspace | erecruitment.caa.co.ug | `staff` |
| Internal Careers | internal-careers.caa.co.ug | `internal` |

The files in this folder are copied onto the server as they are:

| File | Goes to |
|---|---|
| `update-production.sh` | used in place, from `/srv/erecruitment/deploy/production/` |
| `systemd/erecruitment-api.service`, `systemd/erecruitment-jobs.service` | `/etc/systemd/system/` |
| `nginx/erecruit.conf` | `/etc/nginx/conf.d/` (fill in the office ranges) |
| `nginx/snippets/*.conf` | `/etc/nginx/snippets/` |
| `nginx/erecruitment.conf` | `/etc/nginx/sites-available/` |
| `nginx/acme.conf` | `/etc/nginx/sites-available/` (Let's Encrypt only, temporarily) |
| `modsec/main.conf` | `/etc/nginx/modsec/` |
| `maintenance/maintenance.html` | `/var/www/maintenance/` |

## Releases

| Branch | Goes to | How |
|---|---|---|
| `main` | Test (UAT) server | Every change, by pull request; live on UAT within ~5 minutes of CI passing ([deploy/lan](../lan/README.md)) |
| `release` | Production | A pull request from `main` once UAT has passed it; CI tags it; an operator installs the tag |

1. **Open the release PR** on GitHub: base `release`, compare `main`. Put
   `[minor]` or `[major]` in its title for a bigger step in the version
   number; otherwise the patch number goes up. Merge it with **Create a merge
   commit** (not squash or rebase), so `main` and `release` keep one history.
2. **CI tags it.** When every check passes on the `release` push, the
   `tag-release` job in `.github/workflows/ci.yml` tags the commit (`v1.0.0`
   the first time, then `v1.0.1`, `v1.1.0`, ...) and publishes a GitHub
   Release listing the pull requests and any **new database migrations**.
   Before it is installed, the development team adds to the release note
   whether those migrations are backwards-compatible (only adding columns or
   tables). That decides whether a rollback is safe.
3. **An operator installs it**, out of hours (12.4), on erecruit-app01:
   ```bash
   sudo /srv/erecruitment/deploy/production/update-production.sh --tag v1.0.1
   ```
   The script refuses anything that isn't a release tag, a tag older than
   what is live, or a code folder with local changes to tracked files (the
   `.env` files, `node_modules` and the builds are gitignored, so they don't
   count). It then backs up the database to `/var/lib/erecruitment/predeploy`
   (a failed backup stops it before anything changes) and stops the API and
   the scheduler. nginx stays up, and pages say "Server offline" for a few
   minutes. It checks the tag out on branch `production`, installs packages,
   updates the schema, builds the site beside the live one and swaps it in,
   then starts the services and waits for `/health`. If the new release
   doesn't answer within 60 seconds, or any step after the checkout fails, it
   puts the previous release back and starts that. Everything is logged in
   `/var/log/erecruitment/deploy-<date>.log`, and the result is kept in
   `/var/log/erecruitment/deployed.json`.

   - **The pre-release dumps** hold every candidate's personal data on the
     internet-facing server. They are root-only (folder 700, files 600), and
     only the last 5 are kept (`ERECRUIT_KEEP_BACKUPS` to change it). They
     need no more database rights than `erec_app` has:
     `--single-transaction` avoids LOCK TABLES and `--no-tablespaces` avoids
     the server-wide PROCESS privilege.
   - **Ownership:** git, npm and the build run as the operator who ran the
     script, with group-writable files (umask 002), and anything left owned by
     root is handed to them. Every member of `erecruit-ops` can work in
     `/srv/erecruitment` afterwards. `dist` is made readable for nginx
     (`chmod -R o+rX`) after every build.
   - **Uploads are not copied:** no release changes them. Their copy is ICT's
     nightly file backup of `/var/lib/erecruitment/uploads` (plan 2.8).
   - **systemd units are not refreshed.** If a release changes
     `deploy/production/systemd/`, the script ends with a NOTE. Copy the units
     and reload them as in 4.6.

**A fix that can't wait for the next release:** branch from `release`
(`hotfix/...`), open a PR into `release`, install its tag, then merge
`release` back into `main` so the next release keeps the fix.

Protect `release` on GitHub (Settings, Branches): pull requests only, the
`backend`, `backend-e2e` and `frontend` checks required, no force pushes,
merge commits allowed.

## Phase 4: Install the application

As an operator (a member of `erecruit-ops`) in an SSH session to erecruit-app01,
after Phases 2 and 3 of the plan, once a release tag exists.

### 4.0 Before you start

```bash
id | grep -o erecruit-ops                           # prints erecruit-ops
node -v                                            # v24.x.x
ls -A /srv/erecruitment                            # prints nothing (empty folder)
mysql -h <DB01 IP> -u erec_app -p -e "SELECT 1;"   # prints 1
git ls-remote --tags https://github.com/M-JudeCAA/E-Recruitment.git   # lists v1.0.0 or later
```

### 4.1 Get the code

```bash
git clone https://github.com/M-JudeCAA/E-Recruitment.git /srv/erecruitment
cd /srv/erecruitment
git config core.sharedRepository group
git tag --list "v*"                 # pick the release that passed UAT
git checkout -B production v1.0.0
```

Every other operator runs once: `git config --global --add safe.directory /srv/erecruitment`.
Check: `git describe --tags` prints the tag, and `git status` prints
"On branch production" and "nothing to commit".

### 4.2 `backend/.env`

`nano /srv/erecruitment/backend/.env`:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=4100
DATABASE_URL="mysql://erec_app:<password>@<DB01 IP>:3306/erecruitment?connection_limit=20&pool_timeout=20"
JWT_SECRET=<64 random characters>
JWT_EXPIRES_IN=8h
INTERNAL_EMAIL_DOMAIN=caa.co.ug
FRONTEND_URL="https://careers.caa.co.ug,https://erecruitment.caa.co.ug,https://internal-careers.caa.co.ug"
UPLOAD_DIR="/var/lib/erecruitment/uploads"
TRUST_PROXY="loopback"
APP_TIMEZONE=Africa/Kampala
ENTRA_TENANT_ID=<tenant id>
ENTRA_STAFF_CLIENT_ID=<staff app id>
ENTRA_CANDIDATE_CLIENT_ID=<candidate app id>
ENTRA_DIRECTORY_CLIENT_SECRET=<staff app client secret>
ENTRA_STAFF_GROUP_ID=<staff group object id>
SMTP_HOST=<caa-co-ug.mail.protection.outlook.com>
SMTP_PORT=25
SMTP_FROM="UCAA e-Recruitment <erecruitment@caa.co.ug>"
SMTP_FROM_PUBLIC="UCAA Careers <careers@caa.co.ug>"
INTERVIEW_ORGANIZER_EMAIL=recruitment@caa.co.ug
REQUIRE_SITE_HEADER=true
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # the JWT_SECRET; never UAT's
sudo chown erecruit:erecruit-ops /srv/erecruitment/backend/.env
sudo chmod 660 /srv/erecruitment/backend/.env
```

- **The order of `FRONTEND_URL` is fixed:** public site, then HR workspace, then
  Internal Careers. Links in emails are built from it.
- **`REQUIRE_SITE_HEADER=true`** makes the API read the `X-ERecruitment-Site`
  stamp nginx sets (5.6). Without a stamp a request is refused (400). Staff
  and Microsoft sign-in answer 404 on the public site. A staff session is
  refused anywhere but the HR workspace, an employee's session is refused on
  the public site (401), and the live dashboard socket works only on the HR
  workspace.
- **`SMTP_FROM_PUBLIC`** is the sender for External candidates and
  shortlisting committee links. Everyone internal gets mail from `SMTP_FROM`.
- **The API refuses to start** when `JWT_SECRET` is shorter than 32 characters,
  when `DATABASE_URL`, `FRONTEND_URL`, `UPLOAD_DIR` or `INTERNAL_EMAIL_DOMAIN`
  is missing, or when a `FRONTEND_URL` address isn't https. `journalctl -u
  erecruitment-api` says which.
- **The password:** encode any `@ : / ? # % &` in it for `DATABASE_URL`:
  `node -e "console.log(encodeURIComponent(process.argv[1]))" '<password>'`
  (start the line with a space to keep it out of bash history).
- **Placeholders:** replace everything in `<...>`, brackets included.
  `SMTP_HOST` already shows the real value: `<caa-co-ug.mail.protection.outlook.com>`
  becomes `caa-co-ug.mail.protection.outlook.com` (confirm it in plan 6.3).
  The two `SMTP_FROM` lines keep their angle brackets. They're part of the
  address, which is why the check in 4.4 skips anything containing `@`.
- **Never** set `DEV_PASSWORD_LOGIN`. `BREAK_GLASS_LOGIN=true` is only for a
  Microsoft outage (12.4), and works from office addresses only.

### 4.3 `frontend/.env`

```ini
VITE_API_URL=same-origin
VITE_ENTRA_TENANT_ID=<tenant id>
VITE_ENTRA_STAFF_CLIENT_ID=<staff app id>
VITE_ENTRA_CANDIDATE_CLIENT_ID=<candidate app id>
VITE_STAFF_HOST=erecruitment.caa.co.ug
VITE_INTERNAL_HOST=internal-careers.caa.co.ug
VITE_PUBLIC_SITE_URL=https://careers.caa.co.ug
VITE_INTERNAL_SITE_URL=https://internal-careers.caa.co.ug
```

`VITE_STAFF_HOST` and `VITE_INTERNAL_HOST` tell the one build which site it
is on, by host name (`frontend/src/site.js`). They are built in, so they must
be right before each build.

### 4.4 The release script's backup credentials

`sudo nano /etc/erecruitment/backup.cnf`, then `sudo chmod 600 /etc/erecruitment/backup.cnf`:

```ini
[client]
user = erec_app
password = <erec_app password>
host = <DB01 IP>
```

Check for leftover placeholders. These print nothing once every one is filled:

```bash
grep -nE '<[^@>]*>' /srv/erecruitment/backend/.env /srv/erecruitment/frontend/.env
sudo grep -nE '<[^@>]*>' /etc/erecruitment/backup.cnf
```

### 4.5 Install packages, create the schema, build the site

```bash
cd /srv/erecruitment/backend
npm ci --no-audit --no-fund
npx prisma generate
node scripts/prepareDatabase.js       # empty database: creates every table, marks the migrations applied

cd /srv/erecruitment/frontend
npm ci --no-audit --no-fund
npx vite build
grep -l 'internal-careers.caa.co.ug' dist/assets/*.js     # must print a file name
chmod -R o+rX dist
```

Scripts that create or delete uploads run as the service account:
`cd /srv/erecruitment/backend && sudo -u erecruit node scripts/<name>.js`.

### 4.6 The two services

```bash
sudo cp /srv/erecruitment/deploy/production/systemd/erecruitment-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now erecruitment-api erecruitment-jobs
systemctl status erecruitment-api erecruitment-jobs --no-pager    # both "active (running)"
curl -s http://127.0.0.1:4100/health                                # {"status":"ok"}
curl -s http://127.0.0.1:4100/health/ready                          # {"status":"ok","database":"ok"}
```

The units are copied once. When a release changes them (the release script
says so), copy them again and run `sudo systemctl daemon-reload && sudo
systemctl restart erecruitment-api erecruitment-jobs`. `ProtectSystem=strict`
with `ReadWritePaths` lets the API write only to the uploads and log folders. `journalctl -u erecruitment-api -n 100 --no-pager`
shows the API listening and `Email: connected to ...`, with no warning that
Microsoft sign-in is not set up. Keep logs 90 days: in
`/etc/systemd/journald.conf` set `MaxRetentionSec=90day` and
`SystemMaxUse=4G`, then `sudo systemctl restart systemd-journald`. From
another PC, `Test-NetConnection <app01 IP> -Port 4100` must fail.

## Phase 5: Certificate, WAF and nginx

### 5.1 The certificate

Either way it ends as `/etc/nginx/tls/caa-co-ug.fullchain.pem` and `/etc/nginx/tls/caa-co-ug.key`.

**Bought (.pfx with the full chain):**

```bash
sudo mkdir -p /etc/nginx/tls
# The site's own certificate first, then the chain - always in that order
sudo openssl pkcs12 -in /tmp/caa-co-ug.pfx -clcerts -nokeys -out /etc/nginx/tls/caa-co-ug.fullchain.pem
sudo openssl pkcs12 -in /tmp/caa-co-ug.pfx -cacerts -nokeys | sudo tee -a /etc/nginx/tls/caa-co-ug.fullchain.pem >/dev/null
sudo openssl pkcs12 -in /tmp/caa-co-ug.pfx -nocerts -nodes -out /etc/nginx/tls/caa-co-ug.key
sudo chmod 600 /etc/nginx/tls/*
shred -u /tmp/caa-co-ug.pfx
```

(Add `-legacy` to each command if OpenSSL says "unsupported". Each command
asks for the .pfx password.)

**Let's Encrypt:**

```bash
sudo apt install -y certbot
sudo mkdir -p /var/www/acme
sudo cp /srv/erecruitment/deploy/production/nginx/acme.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/acme.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/acme --cert-name erecruitment \
  -d careers.caa.co.ug -d erecruitment.caa.co.ug -d internal-careers.caa.co.ug \
  --agree-tos -m <ICT mailbox> --no-eff-email
sudo mkdir -p /etc/nginx/tls
sudo ln -sf /etc/letsencrypt/live/erecruitment/fullchain.pem /etc/nginx/tls/caa-co-ug.fullchain.pem
sudo ln -sf /etc/letsencrypt/live/erecruitment/privkey.pem /etc/nginx/tls/caa-co-ug.key
printf '#!/bin/sh\nsystemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

Leave `acme.conf` in place until 5.7. Renewal (about every 60 days) needs
`/.well-known/acme-challenge/` answered on port 80 for all three names. From
5.7 on, the port-80 server in `erecruitment.conf` does that, from
`/var/www/acme`, before its redirect to https. 5.7 removes `acme.conf` and
proves renewal still works without it.

Check: `sudo openssl x509 -in /etc/nginx/tls/caa-co-ug.fullchain.pem -noout -subject -ext subjectAltName -enddate`
lists the three names and the expiry date.

### 5.2 The OWASP Core Rule Set

```bash
CRS=<the latest 4.x>                         # from github.com/coreruleset/coreruleset/releases
cd /tmp
wget https://github.com/coreruleset/coreruleset/releases/download/v${CRS}/coreruleset-${CRS}-minimal.tar.gz
wget https://github.com/coreruleset/coreruleset/releases/download/v${CRS}/coreruleset-${CRS}-minimal.tar.gz.asc
# The CRS project's signing key. Compare its fingerprint with the one published
# on coreruleset.org (Installing CRS, verifying a release) before trusting it
gpg --keyserver hkps://keys.openpgp.org --search-keys security@coreruleset.org
gpg --verify coreruleset-${CRS}-minimal.tar.gz.asc coreruleset-${CRS}-minimal.tar.gz   # "Good signature"
sudo mkdir -p /etc/nginx/modsec
sudo tar -xzf coreruleset-${CRS}-minimal.tar.gz -C /etc/nginx/modsec
sudo mv /etc/nginx/modsec/coreruleset-${CRS} /etc/nginx/modsec/crs
sudo cp /etc/nginx/modsec/crs/crs-setup.conf.example /etc/nginx/modsec/crs/crs-setup.conf
```

Don't go on unless gpg says "Good signature" from a key whose fingerprint
matches the published one. Updating CRS later works the same way.

The HR workspace needs PUT, PATCH and DELETE, which CRS refuses by default.
Add at the end of `/etc/nginx/modsec/crs/crs-setup.conf`:

```
SecAction "id:900200,phase:1,pass,t:none,nolog,tag:'OWASP_CRS',setvar:'tx.allowed_methods=GET HEAD POST OPTIONS PUT PATCH DELETE'"
```

### 5.3 ModSecurity's own settings

```bash
# The files that match the installed libmodsecurity, not whatever master holds today
MSV=$(dpkg-query -W -f='${Version}\n' 'libmodsecurity3*' | head -n 1); MSV=${MSV#*:}; MSV=${MSV%%-*}
echo "libmodsecurity $MSV"                  # e.g. 3.0.12
sudo wget -O /etc/nginx/modsec/modsecurity.conf https://raw.githubusercontent.com/owasp-modsecurity/ModSecurity/v${MSV}/modsecurity.conf-recommended
sudo wget -O /etc/nginx/modsec/unicode.mapping https://raw.githubusercontent.com/owasp-modsecurity/ModSecurity/v${MSV}/unicode.mapping
cd /etc/nginx/modsec
sudo sed -i 's/^SecRuleEngine .*/SecRuleEngine DetectionOnly/' modsecurity.conf
sudo sed -i 's/^SecRequestBodyLimit .*/SecRequestBodyLimit 15728640/' modsecurity.conf
sudo sed -i 's/^SecRequestBodyNoFilesLimit .*/SecRequestBodyNoFilesLimit 1048576/' modsecurity.conf
sudo sed -i 's/^SecRequestBodyLimitAction .*/SecRequestBodyLimitAction Reject/' modsecurity.conf
sudo sed -i 's/^SecResponseBodyAccess .*/SecResponseBodyAccess Off/' modsecurity.conf
sudo sed -i 's/^SecAuditEngine .*/SecAuditEngine Off/' modsecurity.conf
grep -E '^Sec(RuleEngine|RequestBodyLimit|RequestBodyNoFilesLimit|RequestBodyLimitAction|ResponseBodyAccess|AuditEngine) ' modsecurity.conf
sudo cp /srv/erecruitment/deploy/production/modsec/main.conf /etc/nginx/modsec/
printf '# UCAA e-Recruitment WAF exclusions (5.9)\n' | sudo tee /etc/nginx/modsec/exclusions.conf
sudo nginx -t
```

The audit log stays off: it would copy session tokens and candidates'
personal data to disk. The WAF's decisions still reach nginx's `error.log`.

### 5.4 to 5.6 The maintenance page, the shared files, the three sites

```bash
sudo mkdir -p /var/www/maintenance /etc/nginx/maintenance /etc/nginx/snippets
P=/srv/erecruitment/deploy/production
sudo cp $P/maintenance/maintenance.html /var/www/maintenance/
sudo cp $P/nginx/erecruit.conf /etc/nginx/conf.d/
sudo cp $P/nginx/snippets/*.conf /etc/nginx/snippets/
sudo cp $P/nginx/erecruitment.conf /etc/nginx/sites-available/
sudo nano /etc/nginx/conf.d/erecruit.conf       # the office ranges in the geo block, one line each
```

> **The office ranges must not contain the edge firewall's inside address.**
> If the port forward rewrites internet visitors' addresses to the firewall's
> own internal address (source NAT), and that address is inside an "office"
> range, every internet visitor counts as the office. They then skip the rate
> limits, get past the maintenance page and can reach the emergency password
> sign-in. List the ranges office PCs actually use, leave out the firewall's
> inside address (if it falls inside an office range, add a line for it alone,
> `<firewall inside IP>/32 0;` - geo always takes the most specific match), and
> treat the audit-log check in 5.8 as a go-live gate.

What `erecruitment.conf` does:

- **The site stamp.** Every request forwarded to the API carries
  `X-ERecruitment-Site`, set by nginx, never by the visitor.
- **The public allow-list.** The public site forwards only the API areas the
  candidate pages and committee links use: `candidates`, `applications`,
  `vacancies`, `shortlist-panel`, `files` and `site-status`. Everything else
  under `/api`, `/ws` and `/health` answers 404 there. If a change gives the
  candidate pages a new API area, add it here too.
- **The emergency sign-in.** `POST /api/staff/auth/login` on the HR
  workspace answers only office addresses (`$from_office`). From the internet
  it answers 404.
- **Rate limits.** 20 requests a second per address on the public site and 5
  on the two others. Office addresses are never limited.
- **The maintenance switch.** While `/etc/nginx/maintenance/careers` or
  `/etc/nginx/maintenance/staff` exists, the internet sees the maintenance
  page and the office keeps working. No reload is needed.
- **The catch-all** refuses any name that isn't one of the three sites.

### 5.7 Turn it on and check it from the server

```bash
sudo ln -sf /etc/nginx/sites-available/erecruitment.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/acme.conf      # erecruitment.conf answers the Let's Encrypt checks from now on
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run                       # Let's Encrypt only: "Congratulations, all simulated renewals succeeded"
curl -sI --resolve erecruitment.caa.co.ug:443:127.0.0.1 https://erecruitment.caa.co.ug/ | head -1          # HTTP/2 200
curl -sI --resolve internal-careers.caa.co.ug:443:127.0.0.1 https://internal-careers.caa.co.ug/ | head -1  # HTTP/2 200
curl -sI --resolve careers.caa.co.ug:443:127.0.0.1 https://careers.caa.co.ug/ | head -1                    # HTTP/2 200
curl -s --resolve careers.caa.co.ug:443:127.0.0.1 https://careers.caa.co.ug/api/site-status                 # {"externalSite":true}
curl -s -o /dev/null -w '%{http_code}\n' --resolve careers.caa.co.ug:443:127.0.0.1 -X POST https://careers.caa.co.ug/api/staff/auth/login    # 404
curl -s -o /dev/null -w '%{http_code}\n' --resolve erecruitment.caa.co.ug:443:127.0.0.1 -X POST https://erecruitment.caa.co.ug/api/staff/auth/login   # 404 (not an office address)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4100/api/vacancies     # 400: no stamp, the API refuses it
sudo ss -tlnp      # only 22, 80, 443, 127.0.0.1:4100, 127.0.0.53:53
```

### 5.8 to 5.9 From outside, then the WAF

Check from the office, from a phone on mobile data, and with SSL Labs, as in
the plan (5.8).

**Go-live gate: real addresses.** Sign in to the HR workspace from the phone
on mobile data. Then, as a system administrator in the office, open **Setup >
Audit log**: the sign-in must show the phone's public address. If it shows the
firewall's address, the port forward is translating the source (plan 1.4).
The rate limits and the office-only emergency sign-in don't work until that is
fixed. Also from the phone, on mobile data:
`curl -s -o /dev/null -w '%{http_code}' -X POST https://erecruitment.caa.co.ug/api/staff/auth/login`
(or any outside machine) must print 404.

Run the WAF in `DetectionOnly` for two weeks and exclude only the false alarms
the log shows, in `/etc/nginx/modsec/exclusions.conf` (plan, 5.9). The HR
site's rich text (adverts, drafts, templates, bulk email) is where to expect
them. Then switch to blocking, at the latest two days before go-live:

```bash
sudo sed -i 's/^SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/nginx/modsec/modsecurity.conf
grep '^SecRuleEngine' /etc/nginx/modsec/modsecurity.conf      # SecRuleEngine On
sudo nginx -t && sudo systemctl reload nginx
```

## Phase 12: Go-live

### 12.1 Two days before: clean out the test data

First take a database backup, on ERECRUIT-DB01:
`Start-ScheduledTask 'e-Recruitment DB backup'`, then check the new file in
`E:\Backups`. Then, on erecruit-app01:

```bash
cd /srv/erecruitment/backend
sudo -u erecruit node scripts/resetDemoData.js                       # read what it would delete
sudo -u erecruit node scripts/resetDemoData.js --yes --production    # every test vacancy, candidate, application and upload; keeps staff accounts
sudo systemctl restart erecruitment-api erecruitment-jobs
```

On the production server, `--yes` alone is refused (`NODE_ENV=production`):
the wipe needs `--production` too, so a command copied from the UAT runbook
can't empty production. The same goes for `clearRecruitmentData.js`.
Check that the public job list is empty and HR staff can still sign in.
Conditional Access goes from report-only to On, the WAF goes to blocking, and
for Let's Encrypt `sudo certbot renew --dry-run` must still succeed.

### 12.3 Go-live morning (checks for ICT)

```bash
systemctl status erecruitment-api erecruitment-jobs nginx --no-pager    # all active
curl -s http://127.0.0.1:4100/health/ready                              # database ok
grep '^SecRuleEngine' /etc/nginx/modsec/modsecurity.conf                # On
ls /etc/nginx/maintenance/                                              # empty
sudo ufw status                                                         # only 22 (admin network), 80 and 443
journalctl -u erecruitment-api -f                                       # watch it through the day
```

### 12.4 If it goes wrong

| Problem | Do |
|---|---|
| Something small (a page bug, wrong wording) | Leave it live. The development team fixes it and a new tag is installed after 17:00 with `update-production.sh --tag` |
| A new release broke it | `sudo /srv/erecruitment/deploy/production/update-production.sh --rollback-to <previous tag>`. Database migrations are **not** undone: a rollback is safe only when the release notes say the newer release's migrations are backwards-compatible |
| Data damaged (a migration failed half-way, data deleted) | `sudo systemctl stop erecruitment-api erecruitment-jobs`; restore the backup taken before the release (the newest file in `/var/lib/erecruitment/predeploy`, below, or the DB server's point-in-time recovery); restore any damaged uploads from ICT's nightly copy (plan 2.8; releases never change uploads); `sudo systemctl start erecruitment-api erecruitment-jobs` |
| A security problem in the application | `sudo touch /etc/nginx/maintenance/careers` (public site) or `.../staff` (both staff-facing sites): the internet sees the maintenance page at once, and the office keeps working. `sudo rm` the file to bring the site back |
| The app server may be compromised | In this order: (1) ICT network disables the port forward (all three sites go off the internet). (2) Revoke what the server holds: change the `erec_app` password on ERECRUIT-DB01 and rotate the Entra client secret (plan 7.4). This needs nothing from the app server. (3) Only then preserve it: leave the VM running and untouched for investigation. Assume `/var/lib/erecruitment/predeploy` (every candidate's data) and the uploads were read, and tell UCAA Legal and the data protection officer. Bring the sites back only on a rebuilt server |
| Microsoft sign-in is down | From the office only: add `BREAK_GLASS_LOGIN=true` to `backend/.env` (`sudoedit`), run `sudo systemctl restart erecruitment-api`, and sign in at `https://erecruitment.caa.co.ug/staff/login?password` with the sealed-envelope password. Afterwards remove the line, restart, and issue a new password (`createSystemAdmin.js --break-glass`) |

To restore one of the release script's dumps, with both services stopped:
first the DBA empties the database on ERECRUIT-DB01
(`DROP DATABASE erecruitment; CREATE DATABASE erecruitment CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`),
so that tables a later migration added go too. Then, on erecruit-app01:

```bash
gunzip -c /var/lib/erecruitment/predeploy/erecruitment_<tag>_<time>.sql.gz | mysql --defaults-extra-file=/etc/erecruitment/backup.cnf erecruitment
```

A dump named `erecruitment_v1.0.1_...` was taken just *before* v1.0.1 was
installed, so it matches the release that was live then (`previous` in
`/var/log/erecruitment/deployed.json`). Put that release's code back with
`update-production.sh --rollback-to <that tag>`, or the next start runs the
newer release's migrations against the restored data.
