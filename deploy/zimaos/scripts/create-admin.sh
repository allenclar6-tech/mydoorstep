#!/usr/bin/env bash
# Create (or reset) a DOORSTEP admin account without the password ever appearing on screen, in shell history,
# in a file, in `ps` output or in the logs. Uses the existing server/createAdmin.js.
#
# Careful: if the email already belongs to an account, that account becomes an ADMIN and its password is replaced.
set -euo pipefail
cd "$(dirname "$0")/.."
read -rp "Admin email: " ADMIN_EMAIL
read -rp "First name [DOORSTEP]: " ADMIN_FIRST_NAME; ADMIN_FIRST_NAME="${ADMIN_FIRST_NAME:-DOORSTEP}"
read -rp "Last name [Owner]: " ADMIN_LAST_NAME; ADMIN_LAST_NAME="${ADMIN_LAST_NAME:-Owner}"
read -rsp "Password (min 12 characters, hidden): " ADMIN_PASSWORD; echo
read -rsp "Repeat password: " again; echo
[ "$ADMIN_PASSWORD" = "$again" ] || { echo "Passwords do not match."; exit 1; }
[ ${#ADMIN_PASSWORD} -ge 12 ] || { echo "Use at least 12 characters."; exit 1; }
export ADMIN_EMAIL ADMIN_PASSWORD ADMIN_FIRST_NAME ADMIN_LAST_NAME
# "-e NAME" without a value copies it from this shell's environment, so it never appears in a command line.
docker compose run --rm --no-deps -e ADMIN_EMAIL -e ADMIN_PASSWORD -e ADMIN_FIRST_NAME -e ADMIN_LAST_NAME api node server/createAdmin.js
unset ADMIN_PASSWORD again
echo "Sign in at https://mydoorstep.com.co/admin/login"
