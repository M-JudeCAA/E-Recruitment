#!/usr/bin/env bash
# One-time setup + first start on a fresh Oracle Cloud Ubuntu VM.
# Safe to re-run: it skips what is already done, and a re-run after
# `git pull` rebuilds and restarts the app.
#
#   bash deploy/oracle/setup-vm.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! grep -qi ubuntu /etc/os-release; then
  echo "This script expects an Ubuntu image (22.04 or 24.04)." >&2
  exit 1
fi

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 2. Firewall. Oracle's Ubuntu images reject everything but SSH in iptables,
# on top of the VCN security list (which also needs 80/443 opened - README).
open_port() { # proto port
  if ! sudo iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null; then
    local reject
    reject=$(sudo iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')
    if [ -n "$reject" ]; then
      sudo iptables -I INPUT "$reject" -p "$1" --dport "$2" -j ACCEPT
    else
      sudo iptables -A INPUT -p "$1" --dport "$2" -j ACCEPT
    fi
  fi
}
open_port tcp 80
open_port tcp 443
open_port udp 443
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
fi

# 3. Settings: free hostnames from sslip.io (they resolve to this VM's IP)
# and random secrets. Edit .env afterwards for real domains or SMTP.
if [ ! -f .env ]; then
  ip=$(curl -fsS https://api.ipify.org)
  host=${ip//./-}.sslip.io
  cat > .env <<EOF
WEB_DOMAIN=jobs.$host
STAFF_DOMAIN=staff.$host
API_DOMAIN=api.$host

MYSQL_PASSWORD=$(openssl rand -hex 24)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)

INTERNAL_EMAIL_DOMAIN=caa.co.ug
APP_TIMEZONE=Africa/Kampala

# "json" = emails are built but not sent. For real email see SETUP.md "Email".
SMTP_HOST=json
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
  chmod 600 .env
  echo "Created deploy/oracle/.env"
fi

# 4. Build and start, wait for health checks, then seed (all seeds upsert,
# so re-running never resets changed passwords).
sudo docker compose up -d --build --wait
sudo docker compose exec -T api npm run seed
sudo docker compose exec -T api node scripts/seedDepartments.js
sudo docker compose exec -T api node scripts/seedSlaPolicies.js

setting() { grep "^$1=" .env | cut -d= -f2-; }
cat <<EOF

Done.
  Candidate site: https://$(setting WEB_DOMAIN)
  Staff site:     https://$(setting STAFF_DOMAIN)/staff/login
  API:            https://$(setting API_DOMAIN)/health

Staff accounts (change these passwords now): hro@caa.co.ug, phro@caa.co.ug,
dhra@caa.co.ug - password ChangeMe123!
EOF
