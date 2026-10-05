# Resetting the database for user testing

A runbook for the server administrator. It empties the recruitment data and
uploaded files so testers start from a clean system with their own data, and
removes the demo staff accounts.

- **Time:** about 30 minutes
- **Needs:** the `shortlisting` branch at commit `65b2b04` or later
- **Script:** `backend/scripts/resetDemoData.js`

> **This cannot be undone.** The reset deletes every vacancy, candidate,
> application, interview, offer, notification and audit record, and every
> uploaded CV, document and photo. The only way back is the backup you take in
> step 3. Do not skip it.

## What the reset does

| Deleted | Kept or recreated |
|---|---|
| All vacancies, drafts and requisitions | Real staff accounts and their Microsoft links |
| All candidates and their applications | SLA settings and the data-retention settings |
| Shortlisting, interviews, merit lists, offers | The 6 directorates and 29 departments (recreated) |
| Notifications, audit and access logs, erasure requests and the erasure log | Job references restart at `UCAA/ADV/…/001/<year>` |
| Edited document templates (they go back to the default wording) | |
| Uploaded files in the upload folder | |
| The six demo staff accounts | |
| Positions (none are recreated) | |

The demo accounts removed are `hro@`, `shro@`, `phro@`, `manager@`, `dhra@`
and `admin@caa.co.ug`. Anyone who registered as a candidate before the reset
will have to register again.

## Steps

### 1. Check Microsoft sign-in works on the server

Once the demo accounts are gone, staff can only sign in with their UCAA
Microsoft account. If Microsoft sign-in isn't set up, nobody will be able to
get in after the reset.

- `backend/.env` has `ENTRA_TENANT_ID`, `ENTRA_STAFF_CLIENT_ID` and
  `ENTRA_CANDIDATE_CLIENT_ID`, and `INTERNAL_EMAIL_DOMAIN=caa.co.ug`.
- `frontend/.env` has `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_STAFF_CLIENT_ID` and
  `VITE_ENTRA_CANDIDATE_CLIENT_ID` (read when the frontend is built).
- When the API starts, its log must **not** say *"Microsoft sign-in (staff)
  is not configured"*.

If these aren't in place yet, stop here and set them up first
([SETUP.md, Microsoft (Entra ID) sign-in](../SETUP.md#microsoft-entra-id-sign-in)).

### 2. Update the code

The reset script and the database changes it relies on are in the latest
code. From the project folder:

```bash
git checkout shortlisting
git pull
cd backend
npm install
npx prisma migrate deploy
npx prisma generate
cd ../frontend
npm install
npm run build
```

`migrate deploy` should finish with *"All migrations have been successfully
applied"* or *"No pending migrations to apply"*. If it reports an error, stop
and send the output to the developers. Redeploy the new frontend build the way
you normally do.

### 3. Back up the database and the upload folder

Find the database name, user and host in `DATABASE_URL` in `backend/.env`
(`mysql://USER:PASSWORD@HOST:PORT/DATABASE`), and the upload folder in
`UPLOAD_DIR` (`./uploads` inside `backend/` if it isn't set).

Database (asks for the password; the same command works in Windows Command
Prompt):

```bash
mysqldump --single-transaction -h HOST -u USER -p DATABASE > erecruitment-before-reset.sql
```

Upload folder, from `backend/`:

```bash
# Linux
tar -czf uploads-before-reset.tar.gz uploads
```

```powershell
# Windows PowerShell
Compress-Archive -Path uploads -DestinationPath uploads-before-reset.zip
```

Check the `.sql` file isn't empty, and keep both files somewhere other than
the server until testing has settled.

### 4. Stop the API and the scheduler worker

Stop both, so nothing writes to the database or the upload folder while it is
being emptied. With pm2 (names from [SETUP.md](../SETUP.md#scheduled-maintenance)):

```bash
pm2 stop erecruitment-api erecruitment-jobs
```

On Windows with NSSM, stop the two services with `nssm stop <service name>`,
or from the Services console.

### 5. Make sure a real system administrator exists

The reset refuses to remove the demo accounts unless another active system
administrator remains, because the administrator is the only one who can
create staff accounts. Use the UCAA Microsoft account the person signs in with
(their sign-in name). Skip this if you already have one.

```bash
# from backend/
node scripts/createSystemAdmin.js --email firstname.lastname@caa.co.ug --name "Full Name" --department ICT
```

It should print *"Created system administrator #N"*. Optional: add
`--break-glass` to also give this account an emergency password for when
Microsoft sign-in is down. It is printed once, so keep it sealed. It only
works while `BREAK_GLASS_LOGIN=true`.

### 6. Do a dry run

Without `--yes` the script changes nothing. It shows which database and folder
it would empty and which demo accounts it would remove.

```bash
# from backend/
node scripts/resetDemoData.js --remove-demo-staff
```

Check every line:

- **Database** is the one you mean to reset. If it shows the wrong host or
  name, stop: the wrong `backend/.env` is being read.
- **Upload folder** is the e-Recruitment upload folder.
- The demo accounts listed are the ones you expect.
- It ends with *"Nothing has been changed. Re-run with --yes to proceed."*

If it says *"Refusing: no active system administrator would be left"*, go back
to step 5.

### 7. Run the reset

```bash
# from backend/
node scripts/resetDemoData.js --remove-demo-staff --yes
```

It lists each table it empties, then *"Deleted N uploaded file(s)"*, the staff
accounts it kept, and the re-created directorates and departments. It
finishes with *"Done - a clean start."*

Only the real administrator (and any other real staff) should appear under
*"Kept … staff account(s)"*. Files in the upload folder that the app didn't
create are left alone.

### 8. Turn off development sign-in and restart

In `backend/.env`, make sure `DEV_PASSWORD_LOGIN` is removed or not `true`,
and `BREAK_GLASS_LOGIN` is not `true` unless there is an emergency. Then start
both processes again:

```bash
pm2 restart erecruitment-api erecruitment-jobs
```

### 9. Check the system

- [ ] The administrator signs in at the staff portal with **Sign in with
      Microsoft** and lands on **Staff accounts**.
- [ ] The staff accounts list shows only real people, with no `hro@`,
      `manager@` or other demo accounts.
- [ ] The public job list on the candidate site is empty.
- [ ] A few minutes after the restart, the home page's system health banner
      shows no warnings about scheduled jobs (the scheduler worker runs them
      all as soon as it starts).

## Before testers start

### Create the testers' staff accounts

The administrator adds each HR tester on **Staff accounts**, with their UCAA
sign-in name and HR role. Testers then sign in with Microsoft; their account
links to them on first sign-in. A staff member needs an account here to get
into the staff portal, even though every UCAA employee can get past the
Microsoft sign-in.

| Role | Can do, for example |
|---|---|
| HR Officer | Upload requisitions and create vacancies, record interview results from the signed score sheets |
| Senior HR Officer | Run the shortlisting committee, schedule interviews, propose merit lists |
| Principal HR Officer | Approve shortlists and merit lists, recommend offers |
| Manager / Director | Approve vacancies and offers |

Each approval must be done by someone other than the person who proposed it,
so testers need at least two people at the approving levels to get through a
whole recruitment.

### Add positions

No positions are recreated. On the **Departments** screen, add the positions
for the departments being tested (for example "HR Analyst" under HR, level
Officer), one at a time or many at once with **Import from a spreadsheet**
(download the template there; one row per position). Departments added by an
import still need a Principal HR Officer's approval, all at once with
**Approve all**. A new vacancy starts from an uploaded EXCO-approved
requisition (the Word document or a PDF saved from Word, plus a scan of the
signed copy), and its job title and "reports to" are matched against these
positions.

### Tell the testers

- Staff sign in at the staff portal with their UCAA Microsoft account.
- External candidates register on the candidate site with email and password.
  UCAA employees applying as candidates use **Sign in with your UCAA account**.
- Accounts from before the reset no longer exist.

## If something goes wrong: restoring the backup

Stop the API and the scheduler worker, restore both backups from step 3, then
start them again.

```bash
mysql -h HOST -u USER -p DATABASE < erecruitment-before-reset.sql
```

Restore the upload folder by extracting `uploads-before-reset.tar.gz`
(Linux: `tar -xzf uploads-before-reset.tar.gz`) or `uploads-before-reset.zip`
(Windows: `Expand-Archive uploads-before-reset.zip -DestinationPath .`) back
into `backend/`.

## Common messages

| Message | What to do |
|---|---|
| Refusing: no active system administrator would be left | Create one with `createSystemAdmin.js` (step 5), then repeat the dry run. |
| … is not on the internal email domain | Set `INTERNAL_EMAIL_DOMAIN=caa.co.ug` in `backend/.env`, and use a `@caa.co.ug` address. |
| Can't reach database server | Check `DATABASE_URL` and that MySQL is running; nothing was deleted. |
| There is no staff account for … (at sign-in) | The administrator hasn't created that person's staff account yet, or used a different address. |
| Microsoft sign-in has not been set up for this site yet | The `VITE_ENTRA_…` values weren't set when the frontend was built. Set them in `frontend/.env` and rebuild. |
