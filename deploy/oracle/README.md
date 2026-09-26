# Deploying on Oracle Cloud Always Free

The whole app on one free VM, run with Docker Compose:

| Container | What it is |
|---|---|
| `mysql` | MySQL 8, data in the `mysql_data` volume |
| `api` | The API. On every start it runs `npm run db:prepare` (see `backend/scripts/prepareDatabase.js`) and then the server. Uploads are in the `uploads_data` volume |
| `scheduler` | The hourly maintenance jobs (`scripts/scheduler.js`) |
| `web` | Caddy. It serves the candidate site and the staff site (the same SPA built a second time with `VITE_STAFF_SITE=true`), proxies the API, and gets HTTPS certificates automatically |

Three hostnames point at the VM: candidate site, staff site, API. With no
domain of your own, the setup script uses free [sslip.io](https://sslip.io)
names such as `jobs.203-0-113-5.sslip.io`, which resolve to the IP in the name.

Fine for demos and testing. Not for live recruitment: there are no
backups beyond the ones you make below, and no uptime guarantee.

## 1. Create the VM

In the Oracle Cloud console, **Compute → Instances → Create instance**:

- **Image:** Canonical Ubuntu 24.04 (or 22.04).
- **Shape:** Ampere `VM.Standard.A1.Flex`, 2 OCPUs and 12 GB memory (within
  Always Free). The 1 GB AMD micro shape is too small to build the frontend.
  If A1 capacity is unavailable in your region, retry later or try another
  availability domain.
- **Networking:** keep "Assign a public IPv4 address" on.
- **SSH keys:** download or paste one; you need it to log in.

## 2. Open ports 80 and 443

**Networking → Virtual cloud networks →** your VCN **→ Security Lists →
Default Security List → Add Ingress Rules**, source `0.0.0.0/0`:

- TCP, destination port `80`
- TCP, destination port `443`
- UDP, destination port `443` (optional, HTTP/3)

The setup script opens the same ports in the VM's own firewall.

## 3. Install and start

```bash
ssh ubuntu@<public-ip>
git clone https://github.com/M-JudeCAA/E-Recruitment.git
cd E-Recruitment
git checkout Dev          # or whichever branch you're presenting
bash deploy/oracle/setup-vm.sh
```

The first run takes 5-10 minutes (image builds). It prints the three URLs
at the end. Sign in on the staff site and change the seeded passwords.

## Day to day

Run these from `deploy/oracle/`:

```bash
# Deploy the latest code
git pull && sudo docker compose up -d --build

# Logs
sudo docker compose logs -f api
sudo docker compose logs -f scheduler

# Status
sudo docker compose ps

# Database backup, to a file in the current directory
sudo docker compose exec -T mysql sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" erecruitment' > backup-$(date +%F).sql

# Uploaded files backup
sudo docker compose cp api:/app/uploads ./uploads-backup
```

## Settings

`deploy/oracle/.env` (created by the script, never committed) holds the
hostnames, database passwords, `JWT_SECRET` and SMTP settings. After editing
it, run `sudo docker compose up -d --build`. Changing a hostname needs the
`--build`, because the API address is built into the frontend.

- **Real email:** set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`
  (see "Email" in [SETUP.md](../../SETUP.md)). With the default
  `SMTP_HOST=json` no email is sent, so candidates can't confirm their
  registration from the link. The HR home page warns about this.
- **Your own domain:** point three DNS A records at the VM's IP and put the
  names in `WEB_DOMAIN`, `STAFF_DOMAIN`, `API_DOMAIN`.

## Troubleshooting

- **Sites don't load at all:** check the security-list rules from step 2.
- **Certificate errors:** Caddy needs ports 80 and 443 reachable from the
  internet to get certificates. Check `sudo docker compose logs web`.
- **API keeps restarting:** `sudo docker compose logs api`. The database
  step runs first and stops the start-up if it fails.
