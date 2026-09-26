# Sharing the app from this computer (Tailscale Funnel)

For demos and testing sessions. The app runs on your Windows computer and
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) puts it on the
internet with fixed HTTPS links:

- Candidate site: `https://<machine>.<tailnet>.ts.net`
- Staff site: `https://<machine>.<tailnet>.ts.net:8443/staff/login`

The links stay the same every time you start it. Tailscale's free Personal
plan needs no card.

What to expect:

- **It works only while this computer is on, awake and online.** Set Windows
  sleep to "Never" while plugged in, and keep the script window open.
- The app uses the database in `backend\.env` (by default the shared dev
  database on Aiven), so testers' data lands there, next to dev data.
- Uploaded files are saved on this computer (`UPLOAD_DIR` in `backend\.env`).
- Some office networks block ports other than 443. If a tester can reach the
  candidate site but not the staff site on `:8443`, that's the cause. Try
  from another network, such as a phone hotspot.

## One-time setup

1. The normal local setup works (see [SETUP.md](../../SETUP.md)):
   `npm install` in `backend` and `frontend`, and `backend\.env` filled in.
2. Install Tailscale and sign in (a Google, Microsoft or GitHub account is
   fine):
   ```powershell
   winget install --id Tailscale.Tailscale
   ```
   Then open a **new** terminal.
3. Choose the names. At https://login.tailscale.com/admin:
   - **Machines:** open this computer → **Edit machine name**, e.g.
     `ucaa-recruit`. That's the first part of the link.
   - **DNS:** check that **MagicDNS** and **HTTPS Certificates** are on. The
     **Tailnet DNS name** (the `<tailnet>` part, e.g. `tail1a2b3c.ts.net`)
     can be changed once to one of the "fun names" Tailscale offers.
4. The first time you start the script, Tailscale may print a link to
   allow Funnel on your tailnet. Open it, approve, and the script carries on.

## Start

From the repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\tunnel\start-demo.ps1
```

It builds the frontend (about a minute), starts the API and the hourly
maintenance jobs, turns on Funnel and prints the two links. Add `-SkipBuild`
to start faster when the frontend code hasn't changed since the last start.
**Ctrl+C** stops everything and turns Funnel off.

Before starting, stop your own local backend (`npm run dev` / `npm start`)
and scheduler (`npm run jobs`): the API port (4000) would clash, and the jobs
would run twice. A brand-new machine name can take a minute or two to work
while its certificate is issued.

## How it works

- One frontend build, served by `vite preview` on local port 4173. Funnel
  sends public port 443 and public port 8443 to it.
- It's built with `VITE_STAFF_PORT=8443`, so the staff routes only render on
  `:8443` and the candidate routes only on the plain address. It's the same
  split the app uses locally (5173/4174), see `src/staffPort.js`.
- Built with `VITE_API_URL=same-origin`: the browser calls `/api` and `/ws`
  on the address it's on, and the preview server forwards them to the API on
  port 4000 (`preview.proxy` in `frontend/vite.config.js`).
- The script passes both links to the API as `FRONTEND_URL`, so links in
  emails (password reset, account set-up) point at them.
- Logs for each process are in `deploy\tunnel\logs\`.

## Troubleshooting

- **"Tailscale is not connected"**: open Tailscale from the system tray and
  sign in.
- **"Blocked request. This host is not allowed"**: you're opening the site
  through a hostname that isn't `*.ts.net`. Add it to
  `preview.allowedHosts` in `frontend/vite.config.js`.
- **"The API did not start"**: see `logs\api.err.log`. Usually the port is
  already in use (another backend running) or the database is unreachable.
- **Staff login page bounces to the home page**: you're on the candidate
  address. Staff use the `:8443` link.
- **"Too many attempts" for testers**: sign-in and registration limits are
  per address. If Funnel doesn't pass on each visitor's own address, all
  testers count as one (20 registrations per hour). Restarting the script
  resets the counters.
