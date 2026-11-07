#!/usr/bin/env bash
# Disaster recovery: replace the DOORSTEP database (and optionally the uploads) with a backup.
#
#   scripts/restore-backup.sh DB_BACKUP.dump [UPLOADS_BACKUP.tar.gz]
#
# This REPLACES live data, so it asks you to type RESTORE first, and it always takes a fresh safety backup of
# the current state into backups/pre-restore/ before touching anything.
set -euo pipefail
cd "$(dirname "$0")/.."
source <(grep -E '^(DOORSTEP_DATA|DOORSTEP_BACKUPS)=' .env)
BACKUPS="${DOORSTEP_BACKUPS:-$DOORSTEP_DATA/backups}"
UPLOADS="$DOORSTEP_DATA/private-uploads"
DB_FILE="${1:?usage: restore-backup.sh DB_BACKUP.dump [UPLOADS_BACKUP.tar.gz]}"
UP_FILE="${2:-}"
[ -s "$DB_FILE" ] || { echo "$DB_FILE not found"; exit 1; }
if [ -f "$DB_FILE.sha256" ]; then (cd "$(dirname "$DB_FILE")" && sha256sum -c "$(basename "$DB_FILE").sha256"); fi
if [ -n "$UP_FILE" ] && [ -f "$UP_FILE.sha256" ]; then (cd "$(dirname "$UP_FILE")" && sha256sum -c "$(basename "$UP_FILE").sha256"); fi
docker compose exec -T db pg_restore --list < "$DB_FILE" > /dev/null || { echo "Not a readable pg_dump file"; exit 1; }

echo "This replaces the current DOORSTEP database${UP_FILE:+ and uploads} with:"
echo "  $DB_FILE ${UP_FILE:+
  $UP_FILE}"
read -rp "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled. Nothing changed."; exit 1; }

safety="$BACKUPS/pre-restore/$(date +%Y%m%d-%H%M)"; mkdir -p "$safety"; umask 077
echo "Safety backup of the current state -> $safety"
docker compose exec -T db pg_dump -U doorstep -d doorstep --format=custom --no-owner > "$safety/doorstep.dump"
[ -d "$UPLOADS" ] && tar -czf "$safety/uploads.tar.gz" -C "$UPLOADS" .

docker compose stop api
docker compose exec -T db psql -U doorstep -d postgres -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='doorstep' and pid<>pg_backend_pid();" -c "drop database doorstep;" -c "create database doorstep owner doorstep;"
docker compose exec -T db pg_restore -U doorstep -d doorstep --no-owner --no-acl --exit-on-error < "$DB_FILE"

if [ -n "$UP_FILE" ]; then
  mv "$UPLOADS" "$UPLOADS.before-restore-$(date +%Y%m%d-%H%M)"
  mkdir -p "$UPLOADS"; tar -xzf "$UP_FILE" -C "$UPLOADS"
fi
docker compose up -d api
echo "Restored. The previous state is kept in $safety. Check: docker compose logs -f api"
