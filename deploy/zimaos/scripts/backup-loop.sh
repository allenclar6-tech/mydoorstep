#!/bin/sh
# Runs inside the "backup" container. Every day at BACKUP_HOUR (Africa/Lagos) it writes:
#   /backups/db/doorstep-YYYYMMDD-HHMM.dump        (pg_dump custom format; restore with pg_restore)
#   /backups/uploads/uploads-YYYYMMDD-HHMM.tar.gz  (all private uploads)
# with a .sha256 next to each, and deletes sets older than BACKUP_KEEP_DAYS.
# Run one immediately with:  docker compose exec backup sh /backup-loop.sh now
set -eu
HOUR="${BACKUP_HOUR:-2}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups/db /backups/uploads 2>/dev/null || true
umask 077

run_backup() {
  # Backups belong on a different disk from the data. The target folder carries this marker file; if it is
  # missing, the disk isn't mounted and Docker is showing an empty folder on the system disk instead.
  if [ ! -e /backups/.doorstep-backup-target ]; then
    echo "[backup] FAILED: /backups/.doorstep-backup-target missing - is the backup disk mounted?" >&2
    return 1
  fi
  stamp=$(date +%Y%m%d-%H%M)
  db="/backups/db/doorstep-$stamp.dump"
  up="/backups/uploads/uploads-$stamp.tar.gz"
  echo "[backup] $stamp starting"
  pg_dump --format=custom --no-owner --file="$db.partial" && mv "$db.partial" "$db"
  pg_restore --list "$db" > /dev/null   # proves the file is a readable dump
  (cd /backups/db && sha256sum "$(basename "$db")" > "$(basename "$db").sha256")
  tar -czf "$up.partial" -C /uploads . && mv "$up.partial" "$up"
  (cd /backups/uploads && sha256sum "$(basename "$up")" > "$(basename "$up").sha256")
  find /backups/db /backups/uploads -type f -mtime +"$KEEP" -delete
  echo "[backup] $stamp done: $(du -h "$db" | cut -f1) database, $(du -h "$up" | cut -f1) uploads"
}

if [ "${1:-}" = "now" ]; then run_backup; exit 0; fi

echo "[backup] scheduled daily at ${HOUR}:00 $(date +%Z), keeping ${KEEP} days"
while true; do
  if [ "$(date +%H)" -eq "$HOUR" ] && [ ! -e "/backups/.done-$(date +%Y%m%d)" ]; then
    if run_backup; then
      rm -f /backups/.done-*; touch "/backups/.done-$(date +%Y%m%d)"
    else
      echo "[backup] FAILED - will retry in 10 minutes" >&2
    fi
  fi
  sleep 600
done
