#!/bin/sh
# Makes sure the private-upload folder (a mounted volume) belongs to the unprivileged "node" user, then runs
# the API as that user. Works for a ZimaOS bind mount, a Docker volume or a Render disk.
set -e
UPLOAD_DIR="${PRIVATE_UPLOAD_DIR:-/data/private-uploads}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOAD_DIR"
  # Only touch files not already owned by node, so restarts stay fast with many uploads.
  find "$UPLOAD_DIR" \! -user node -exec chown node:node {} +
  chmod 700 "$UPLOAD_DIR"
  exec su-exec node "$@"
fi
exec "$@"
