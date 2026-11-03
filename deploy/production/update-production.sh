#!/usr/bin/env bash
# Installs a release on the production app server (erecruit-app01), by hand:
#
#   sudo /srv/erecruitment/deploy/production/update-production.sh --tag v1.0.1
#   sudo /srv/erecruitment/deploy/production/update-production.sh --rollback-to v1.0.0
#
# Run by an operator (a member of erecruit-ops) through sudo, never on a
# timer. It:
#   1. refuses anything that isn't a release tag (vMAJOR.MINOR.PATCH, made by
#      CI on the release branch), a tag older than what is live (--tag), or a
#      code folder with local changes;
#   2. backs up the database (mysqldump with /etc/erecruitment/backup.cnf) to
#      /var/lib/erecruitment/predeploy (root only, 600; the last
#      ERECRUIT_KEEP_BACKUPS, default 5 - they hold every candidate's personal
#      data on the internet-facing server), and stops if the backup fails;
#   3. stops the API and the scheduler (nginx stays up; pages say "Server
#      offline" for a few minutes), checks the tag out on branch production
#      as the operator, so files stay theirs;
#   4. installs packages, updates the database schema and builds the site
#      beside the live one (dist-next, swapped in; the old one kept as
#      dist-previous), all as the operator with group-writable files, so
#      any member of erecruit-ops can run git and npm there afterwards;
#   5. starts both services and waits up to 60 seconds for /health. If it
#      never answers - or any step after the checkout fails - it puts the
#      previous release back and starts that, and exits with an error.
#
# --rollback-to goes back to an earlier tag. Database migrations are NOT
# undone: only safe when the release notes say the newer release's
# migrations are backwards-compatible (deploy/production/README.md).
#
# Uploads aren't copied: no release changes them. Their copy is ICT's nightly
# file backup (plan 2.8). The systemd units are not refreshed either: when a
# release changes deploy/production/systemd/, it says so at the end, and the
# operator copies them and runs daemon-reload (README, 4.6).
#
# Every step goes to /var/log/erecruitment/deploy-<date>.log, the result to
# /var/log/erecruitment/deployed.json.
set -Eeuo pipefail

APP_DIR=/srv/erecruitment
BACKUP_CNF=/etc/erecruitment/backup.cnf
BACKUP_DIR=/var/lib/erecruitment/predeploy
LOG_DIR=/var/log/erecruitment
DB_NAME=${ERECRUIT_DB_NAME:-erecruitment}
KEEP_BACKUPS=${ERECRUIT_KEEP_BACKUPS:-5}
SERVICES=(erecruitment-api erecruitment-jobs)
HEALTH_URL=http://127.0.0.1:4100/health

usage() {
  echo "Usage: sudo $0 --tag vX.Y.Z | --rollback-to vX.Y.Z" >&2
  exit 2
}

mode=""; tag=""
case "${1:-}" in
  --tag) mode=install; tag="${2:-}" ;;
  --rollback-to) mode=rollback; tag="${2:-}" ;;
  *) usage ;;
esac
[[ $# -eq 2 ]] || usage
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Not a release tag: '$tag' (expected vX.Y.Z)." >&2; exit 2; }

[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 2; }
operator="${SUDO_USER:-}"
[[ -n "$operator" && "$operator" != root ]] || { echo "Run it with sudo from your own account, not as root." >&2; exit 2; }
id -nG "$operator" | grep -qw erecruit-ops || { echo "$operator is not in erecruit-ops." >&2; exit 2; }

mkdir -p "$LOG_DIR"
log_file="$LOG_DIR/deploy-$(date +%F).log"
exec > >(tee -a "$log_file") 2>&1
say() { echo "$(date '+%F %T') $*"; }

# As the operator, with umask 002: files npm, git and the build create stay
# writable for the rest of erecruit-ops (2.5), not only for whoever ran it.
as_operator() { sudo -u "$operator" -H bash -c 'umask 002 && exec "$@"' bash "$@"; }
git_op() { as_operator git -C "$APP_DIR" "$@"; }

say "===== $mode $tag, by $operator"

# --- 1. Checks, before anything is stopped ---------------------------------
git_op fetch --quiet --tags origin
git_op rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null || { say "No tag $tag on GitHub."; exit 1; }
# Tracked files only: .env, node_modules and the builds are gitignored.
if ! git_op diff --quiet HEAD || ! git_op diff --quiet --cached HEAD; then
  say "$APP_DIR has local changes (git status). Production runs only released code; undo them first."
  exit 1
fi

live=$(git_op describe --tags --exact-match HEAD 2>/dev/null || true)
live_commit=$(git_op rev-parse HEAD)
newest() { printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1; }
if [[ -n "$live" ]]; then
  if [[ "$tag" == "$live" ]]; then say "$tag is already live - nothing to do."; exit 0; fi
  if [[ $mode == install && "$(newest "$tag" "$live")" == "$live" ]]; then
    say "$tag is older than what is live ($live). To go back, use --rollback-to $tag."
    exit 1
  fi
  if [[ $mode == rollback && "$(newest "$tag" "$live")" == "$tag" ]]; then
    say "$tag is newer than what is live ($live) - use --tag $tag."
    exit 1
  fi
fi
if [[ $mode == rollback ]]; then
  say "WARNING: going back to $tag does not undo the database migrations of $live."
  say "Only safe if $live's release notes say its migrations are backwards-compatible."
fi

# --- 2. Database backup ----------------------------------------------------
[[ -r "$BACKUP_CNF" ]] || { say "$BACKUP_CNF is missing (README, 4.4)."; exit 1; }
umask 077
mkdir -p "$BACKUP_DIR"
chown root:root "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
backup="$BACKUP_DIR/erecruitment_${tag}_$(date +%Y%m%d-%H%M%S).sql.gz"
say "Backing up the database to $backup"
# --single-transaction: a consistent copy without LOCK TABLES; --no-tablespaces:
# no server-wide PROCESS privilege, which erec_app doesn't have;
# --set-gtid-purged=OFF: no RELOAD/FLUSH_TABLES privilege if GTIDs are ever on.
if ! mysqldump --defaults-extra-file="$BACKUP_CNF" --single-transaction --no-tablespaces --set-gtid-purged=OFF     --routines --triggers "$DB_NAME" | gzip > "$backup"; then
  rm -f "$backup"
  say "The database backup failed - nothing has been changed."
  exit 1
fi
# A dump that never got going is a few bytes of gzip header.
[[ $(stat -c %s "$backup") -gt 1024 ]] || { rm -f "$backup"; say "The database backup is empty - nothing has been changed."; exit 1; }
ls -1t "$BACKUP_DIR"/erecruitment_*.sql.gz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
umask 022

# --- 3 to 5. Stop, install, start ------------------------------------------
build_backend() {
  ( cd "$APP_DIR/backend" && as_operator npm ci --no-audit --no-fund && as_operator npx prisma generate )
}

start_and_check() {
  systemctl start "${SERVICES[@]}"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

record() {
  printf '{\n  "tag": "%s",\n  "commit": "%s",\n  "mode": "%s",\n  "result": "%s",\n  "previous": "%s",\n  "backup": "%s",\n  "by": "%s",\n  "at": "%s"\n}\n' \
    "$1" "$(git_op rev-parse HEAD)" "$mode" "$2" "${live:-$live_commit}" "$backup" "$operator" "$(date -Is)" > "$LOG_DIR/deployed.json"
}

swapped=false
# Puts back what was live before this run and starts it.
restore_previous() {
  say "Putting back ${live:-$live_commit}"
  systemctl stop "${SERVICES[@]}" || true
  git_op checkout --quiet -B production "$live_commit"
  if $swapped && [[ -d "$APP_DIR/frontend/dist-previous" ]]; then
    rm -rf "$APP_DIR/frontend/dist"
    mv "$APP_DIR/frontend/dist-previous" "$APP_DIR/frontend/dist"
  fi
  rm -rf "$APP_DIR/frontend/dist-next"
  build_backend
  if start_and_check; then
    say "${live:-$live_commit} is running again."
    record "${live:-$live_commit}" "failed: $tag not installed, previous put back"
  else
    say "The previous release does not answer either - see journalctl -u erecruitment-api."
    record "${live:-$live_commit}" "failed: $tag not installed, previous did not start"
  fi
}

failed() {
  trap - ERR
  say "FAILED installing $tag (line $1) - see $log_file"
  restore_previous || say "Putting the previous release back failed as well."
  exit 1
}

say "Stopping ${SERVICES[*]}"
systemctl stop "${SERVICES[@]}"
trap 'failed $LINENO' ERR

say "Checking out $tag on branch production"
git_op checkout --quiet -B production "$tag"

say "Installing API packages and updating the database schema"
build_backend
( cd "$APP_DIR/backend" && as_operator node scripts/prepareDatabase.js )

say "Building the site"
( cd "$APP_DIR/frontend" && as_operator npm ci --no-audit --no-fund && as_operator npx vite build --outDir dist-next --emptyOutDir )
rm -rf "$APP_DIR/frontend/dist-previous"
[[ -d "$APP_DIR/frontend/dist" ]] && mv "$APP_DIR/frontend/dist" "$APP_DIR/frontend/dist-previous"
mv "$APP_DIR/frontend/dist-next" "$APP_DIR/frontend/dist"
swapped=true
chmod -R o+rX "$APP_DIR/frontend/dist"

say "Starting ${SERVICES[*]}"
if ! start_and_check; then
  trap - ERR
  say "The API did not answer $HEALTH_URL within 60 seconds - see journalctl -u erecruitment-api."
  restore_previous
  exit 1
fi
trap - ERR

# Anything root created in the code folder goes to the operator, so no one
# is locked out of git or npm next time.
find "$APP_DIR" -user root -exec chown "$operator:erecruit-ops" {} + \
  || say "NOTE: could not hand root-owned files in $APP_DIR to $operator - check with: find $APP_DIR -user root"

# The units in /etc/systemd/system were copied by hand (4.6); say when this
# release brings different ones.
for unit in "$APP_DIR"/deploy/production/systemd/*.service; do
  installed="/etc/systemd/system/$(basename "$unit")"
  if ! cmp -s "$unit" "$installed"; then
    say "NOTE: $(basename "$unit") in this release differs from $installed. Copy it and run"
    say "      sudo systemctl daemon-reload && sudo systemctl restart ${SERVICES[*]}"
  fi
done

# Production runs with the public careers site open (README, 4.2).
if curl -fsS -m 5 -H 'X-ERecruitment-Site: public' "${HEALTH_URL%/health}/api/site-status" | grep -q '"externalSite":false'; then
  say "WARNING: the public careers site is CLOSED (EXTERNAL_SITE_ENABLED=false in backend/.env)."
  say "         To open it: set EXTERNAL_SITE_ENABLED=true, then sudo systemctl restart erecruitment-api"
fi

record "$tag" "$([[ $mode == rollback ]] && echo "rolled back" || echo installed)"
say "Done: $tag is live (backup: $backup)."
