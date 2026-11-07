#!/usr/bin/env bash
# One-time move of the live DOORSTEP data into the new ZimaOS database.
#
#   scripts/import-database.sh --from-render      asks for Render's External Database URL (typed, not echoed),
#                                                 dumps it, then restores the dump here
#   scripts/import-database.sh --from-file FILE   restores an existing dump: pg_dump custom (.dump), plain SQL
#                                                 (.sql / .sql.gz) or a Render export (.tar.gz of a directory dump)
#   optional: --uploads FILE.tar.gz               also unpacks the private uploads copied from the Render disk
#
# Safe by design: refuses to run unless the new database is EMPTY and the uploads folder has no files, so it
# can never overwrite data. The API is stopped while importing and started afterwards; its start-up step
# (server/migrate.js) then checks the reviewed baseline and applies any newer migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
source <(grep -E '^(DOORSTEP_DATA|DOORSTEP_BACKUPS)=' .env)
BACKUPS="${DOORSTEP_BACKUPS:-$DOORSTEP_DATA/backups}"
UPLOADS="$DOORSTEP_DATA/private-uploads"
MODE="" FILE="" UPLOADS_TAR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-render) MODE=render ;;
    --from-file) MODE=file; FILE="${2:?file path}"; shift ;;
    --uploads) UPLOADS_TAR="${2:?uploads .tar.gz}"; shift ;;
    *) echo "Unknown option $1"; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { sed -n '2,13p' "$0"; exit 2; }

docker compose up -d db
until docker compose exec -T db pg_isready -U doorstep -d doorstep >/dev/null 2>&1; do sleep 2; done

tables=$(docker compose exec -T db psql -U doorstep -d doorstep -Atc "select count(*) from pg_tables where schemaname='public'")
if [ "$tables" != "0" ]; then
  echo "STOP: the new database already has $tables tables. Nothing was changed."
  echo "Use scripts/restore-backup.sh to replace a database on purpose."
  exit 1
fi
if [ -n "$UPLOADS_TAR" ] && [ -d "$UPLOADS" ] && [ -n "$(find "$UPLOADS" -type f -print -quit)" ]; then
  echo "STOP: $UPLOADS already contains files. Nothing was changed."; exit 1
fi

docker compose stop api >/dev/null 2>&1 || true
mkdir -p "$BACKUPS/import"
umask 077

if [ "$MODE" = render ]; then
  read -rsp "Paste Render's External Database URL (input hidden): " RENDER_URL; echo
  FILE="$BACKUPS/import/render-$(date +%Y%m%d-%H%M).dump"
  echo "Dumping from Render (read-only) to $FILE ..."
  # A throwaway client container on the normal network; the URL goes in through the environment, not argv.
  docker run --rm -e SRC_URL="$RENDER_URL" postgres:17-alpine sh -c 'pg_dump "$SRC_URL" --format=custom --no-owner --no-acl' > "$FILE.partial"
  mv "$FILE.partial" "$FILE"
  unset RENDER_URL
fi

[ -s "$FILE" ] || { echo "Dump file $FILE is missing or empty."; exit 1; }
sha256sum "$FILE" | tee "$FILE.sha256"

echo "Restoring into the new database ..."
case "$FILE" in
  *.tar.gz|*.tgz)
    work=$(mktemp -d); tar -xzf "$FILE" -C "$work"
    toc=$(find "$work" -name toc.dat -print -quit); [ -n "$toc" ] || { echo "No directory-format dump (toc.dat) inside $FILE"; exit 1; }
    dir=$(dirname "$toc")
    docker compose cp "$dir" db:/tmp/import-dir
    docker compose exec -T db pg_restore -U doorstep -d doorstep --no-owner --no-acl --exit-on-error /tmp/import-dir
    docker compose exec -T db rm -rf /tmp/import-dir; rm -rf "$work" ;;
  *.sql.gz) gunzip -c "$FILE" | docker compose exec -T db psql -U doorstep -d doorstep -v ON_ERROR_STOP=1 -q ;;
  *.sql)    docker compose exec -T db psql -U doorstep -d doorstep -v ON_ERROR_STOP=1 -q < "$FILE" ;;
  *)        docker compose exec -T db pg_restore -U doorstep -d doorstep --no-owner --no-acl --exit-on-error < "$FILE" ;;
esac

if [ -n "$UPLOADS_TAR" ]; then
  mkdir -p "$UPLOADS"; tar -xzf "$UPLOADS_TAR" -C "$UPLOADS"
  echo "Uploads restored: $(find "$UPLOADS" -type f | wc -l) files"
fi

echo "Row counts in the new database:"
docker compose exec -T db psql -U doorstep -d doorstep -c 'select (select count(*) from "User") users, (select count(*) from "Restaurant") stores, (select count(*) from "Order") orders, (select count(*) from "_prisma_migrations") migrations'
echo "Starting the API (it runs the guarded migrations first) ..."
docker compose up -d api
echo "Watch it with: docker compose logs -f api   (look for [database] migrations_ready)"
