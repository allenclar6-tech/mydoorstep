# DOORSTEP production on ZimaOS

DOORSTEP's production site, API, database and uploads run on the owner's ZimaOS server with Docker Compose
(since the cut-over on 2026-11-08). This guide covers how it is set up, how to operate, update, back up and restore
it, and how to fall back. Files live in [deploy/zimaos/](../deploy/zimaos/).

## 1. What runs where

```
 visitors ──HTTPS──> Cloudflare (mydoorstep.com.co, www, api)  ── Cloudflare Tunnel "doorstep-zimaos" ──┐
                                                                                                        ▼
 ZimaOS server ─ Docker Compose project "doorstep" ───────────────────────────────────────────────────────────
   cloudflared   tunnel connector (outbound only: no router ports are open)
        │
        ▼
   web     nginx: React site, Android app links, APK links, cache headers;
           forwards /api/* and the live-delivery WebSocket, and all of api.mydoorstep.com.co, to the API
        │
        ▼
   api     Express + Prisma, port 4000, exactly ONE instance (dispatch, payout and push loops run inside it)
        │  uploads: /DATA/AppData/doorstep/data/private-uploads
        ▼
   db      PostgreSQL 18, internal Docker network only, no port
   backup  nightly pg_dump + uploads archive
```

- **Admin** is part of the website (`/admin/login`, `/admin/dashboard`); there is no separate admin service. The
  customer and *DOORSTEP Admin* Android apps are full-screen wrappers of the website and need only
  `/.well-known/assetlinks.json`, which the web container serves.
- **Why everything goes through the web container**: on mydoorstep.com.co the site calls `/api` on its own domain
  (`src/config/apiBase.js`). Routing `api.mydoorstep.com.co` through the same nginx means the visitor's address is
  worked out in one place: the API trusts one proxy hop and rate-limits by that address
  (`TRUST_CLOUDFLARE_IP=on` makes nginx use Cloudflare's `CF-Connecting-IP`).
- **One API container only.** Two copies would run payouts twice and split the local uploads.

## 2. The server

| | |
|---|---|
| Machine | ZimaOS 1.8.0, x86_64, 12 CPUs, 15.6 GB RAM, 1.8 TB data disk (`/DATA`) |
| Code | `/DATA/AppData/doorstep/src` (git checkout of branch `deploy/zimaos-2026-11-07`) |
| Settings | `/DATA/AppData/doorstep/src/deploy/zimaos/.env` (root-only; `.env.bak-*` are earlier copies) |
| Data | `/DATA/AppData/doorstep/data/` → `postgres/`, `private-uploads/` (data disk sda) |
| Backups | `/media/HDD-Storage/DOORSTEP-Backups/` (second disk sdb) |
| Web port on the LAN | `8090` (for checks from the home network; not opened on the router) |
| Other apps (untouched) | Nginx Proxy Manager (8080/4443/81), "Webserver" nginx (82), Portainer (9000/9443), an older `cloudflared-web` tunnel that belongs to a *different* Cloudflare account and can't serve this domain |

Leftovers you can delete once the new setup has run for a few weeks: `/DATA/AppData/doorstep/staging` (the first,
empty validation run) and `/DATA/AppData/doorstep-files/DOORSTEP` (the project copy that used to sit in the
Webserver folder, where its `.env` was downloadable; it was moved out on 2026-11-08).

**Cloudflare** (account that owns mydoorstep.com.co): tunnel `doorstep-zimaos`, public hostnames
`mydoorstep.com.co`, `www.mydoorstep.com.co`, `api.mydoorstep.com.co` → `http://web:80`; DNS records for those three
are proxied CNAMEs to `<tunnel-id>.cfargotunnel.com`; *Always Use HTTPS* is on. The tunnel token lives only in the
server's `.env` (`CLOUDFLARE_TUNNEL_TOKEN`). The Resend email records (`send`, `rsend`, `resend._domainkey`) are
separate and must stay.

**Paystack** (live): webhook `https://api.mydoorstep.com.co/api/payments/webhook`, callback
`https://mydoorstep.com.co/payment/callback`.

## 3. Running commands on the server

SSH logins are not set up on this ZimaOS, so commands run through **Portainer** (`https://<server-ip>:9443`):

1. Portainer → *Containers* → *Add container*.
2. Name `doorstep-shell`, image `docker:27.5-cli`.
3. *Advanced → Command & logging*: Command `sleep infinity`, Working Dir `/DATA/AppData/doorstep/src/deploy/zimaos`,
   Console *Interactive & TTY*.
4. *Advanced → Volumes* → *Bind*: `/var/run/docker.sock` → `/var/run/docker.sock`, and
   `/DATA/AppData/doorstep` → `/DATA/AppData/doorstep` (the **same path on both sides**, or compose's folder paths break).
5. *Deploy*, then open the container → *Console* → *Connect* (`/bin/sh`). Every command in this guide works there.
6. Remove the container when you are done.

(To let Claude do it instead: create a Portainer access token under *My account → Access tokens*, share it, and
delete it afterwards.)

Everyday checks:
```sh
docker compose --profile tunnel ps                   # all "Up", api/web/db "healthy"
docker compose logs --tail 50 api                    # look for errors
docker compose exec web nginx -t                     # nginx config check
wget -qO- http://<server-ip>:8090/api/ready          # {"status":"ready","database":"ok"}
```
Always include `--profile tunnel` with `up`, `down` or `ps`, or the tunnel container is left out.

## 4. Settings (.env)

Template with every variable the server reads: [deploy/zimaos/zimaos.env.example](../deploy/zimaos/zimaos.env.example).
The values that must never change by accident:

| Value | Why |
|---|---|
| `POSTGRES_PASSWORD` | the database was created with it |
| `CARD_TOKEN_ENCRYPTION_KEY` | a different value makes every saved card unusable |
| `CLOUDFLARE_TUNNEL_TOKEN` | the site goes offline without it |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | live keys; after rotating in Paystack, update both and restart the API |

After editing: `docker compose --profile tunnel up -d` (only changed containers restart).
Not used by the code: `AUTH_SECRET` (sessions are random tokens stored hashed in the database) and
`FIREBASE_CONFIGURATION` (push uses standard Web Push; its keys are stored in the database).

Production must **not** contain `DISPATCH_SWEEP=off`, `PAYOUT_SWEEP=off` or `PUSH_SWEEP=off` (test servers only).

## 5. Updating the app

```sh
cd /DATA/AppData/doorstep/src && git pull --ff-only
cd deploy/zimaos
docker compose exec backup sh /backup-loop.sh now       # backup first
docker compose --profile tunnel up -d --build
docker compose logs api | grep -E "migrations_ready|listening"
```
The API applies new Prisma migrations itself at start, guarded by the baseline check in `server/migrate.js`.
Never run `prisma db push` or `npm run db:seed` against this database (the seed adds demo stores).

The old flow (`npm run cloudflare:deploy`, or pushing to `main` for Render) **no longer updates the live site**.

## 6. Admin account

```sh
bash scripts/create-admin.sh
```
Asks for email, name and a password (hidden, at least 12 characters, never written to a file, history or log) and runs
`server/createAdmin.js`. If the email already has an account, it becomes an admin with the new password. Your
existing admin accounts came across with the data.

## 7. Backups and recovery

- The `backup` container writes a database dump and an uploads archive **every night at 02:00 (Lagos)** to
  `/media/HDD-Storage/DOORSTEP-Backups/{db,uploads}/` on the **second disk** (sdb, 932 GB), checks each dump is
  readable, writes `.sha256` files and keeps 14 days. Run one now: `docker compose exec backup sh /backup-loop.sh now`.
- If the second disk is not mounted, the job logs `FAILED ... is the backup disk mounted?` and skips (it looks for the
  marker file `.doorstep-backup-target` in that folder). Check with `docker compose logs backup`.
- Cut-over copies are kept in `import/` (the final Render export) and `pre-switch/` in the same folder.
- The second disk protects against the data disk failing, not against theft, fire or a power surge. Also copy the
  folder off the server weekly (ZimaOS Backup app, or to your PC / Google Drive). Keep a copy of `.env` in a password
  manager: without `CARD_TOKEN_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` a restore is much harder.
- **Restore** (replaces the current data; asks you to type RESTORE and saves the current state first):
  ```sh
  bash scripts/restore-backup.sh /media/HDD-Storage/DOORSTEP-Backups/db/doorstep-YYYYMMDD-HHMM.dump \
                                 /media/HDD-Storage/DOORSTEP-Backups/uploads/uploads-YYYYMMDD-HHMM.tar.gz
  ```
- **Test a restore once a month** on a copy: in a separate folder with `DOORSTEP_DATA=/DATA/AppData/doorstep-restore-test`,
  another `WEB_HOST_PORT`, no tunnel, and `docker compose -p doorstep-test ...`; delete the copy afterwards.
- **Whole-server loss**: new ZimaOS → clone the repo to the same path → put back `.env` → `docker compose up -d db` →
  `restore-backup.sh` with the newest files → `docker compose --profile tunnel up -d --build`. The tunnel reconnects
  by itself; DNS needs no change.

## 8. Falling back to Render (emergency only)

Render (`mydoorstep-api`, `mydoorstep-db`) was **suspended, not deleted**, and the Cloudflare Worker
`mydoorstep-site-20260922` still exists. Its database stopped at the cut-over, so anything that happened on ZimaOS
afterwards (orders, sign-ups) must be copied back by hand. To fall back:

1. Render → `mydoorstep-api` → Settings → **Resume Web Service**.
2. Cloudflare → DNS: delete the `mydoorstep.com.co` and `www` CNAMEs to the tunnel; Workers & Pages →
   `mydoorstep-site-20260922` → Settings → Domains & Routes → add custom domain `mydoorstep.com.co`.
3. Paystack webhook back to `https://mydoorstep.com.co/api/payments/webhook`.
4. On ZimaOS add `PAYOUT_SWEEP=off`, `DISPATCH_SWEEP=off`, `PUSH_SWEEP=off` to `.env` and
   `docker compose --profile tunnel up -d`, so the two servers don't both pay out or notify.

Once ZimaOS has run well for a week or two, delete the Render services (they cost money while they exist) and remove
the `render.yaml`/Worker flow from your routine.

## 9. Test checklist (after any big change)

| Area | Check |
|---|---|
| Customer | register (email code arrives), sign in, Google sign-in, profile photo upload |
| Shopping | browse stores, cart, checkout; order shows *paid* only after the server confirms |
| Webhook | Paystack → Settings → Webhooks → delivery log shows `200` for the charge |
| Tracking | live order tracking updates; rider "Start location sharing" works |
| Restaurant | apply with documents, admin approves, partner accepts orders, uploads logo/menu photos |
| Rider | apply with documents, admin approves, accepts a delivery, delivery code completes it |
| Admin | `/admin/login`, approvals, document archive opens files, money/payouts pages |
| Refunds | cancel a paid order → refund appears in Paystack |
| Notifications | in-app bell, phone push after allowing notifications |
| Android | both apps open full-screen (no address bar); `/downloads/doorstep.apk` downloads |
| Restart | `docker compose restart api` → uploads and sign-ins survive; reboot the server → everything comes back |

Test payments with Paystack test keys need a store **without** a Paystack payout split (or with the split paused on
a copy of the data): live subaccount codes don't exist in test mode, so Paystack rejects those payments.

## 10. Cut-over record (2026-11-08)

1. Code built and validated on the server against an empty database; the frontend fixes (rider location sharing,
   no Render fallback address) went live with it.
2. The server copy of the project in `/DATA/AppData/Web/fejiro/DOORSTEP` was found publicly downloadable on port 82
   (`.env` with a test Paystack key, uploads) and moved out of the web root.
3. Rehearsal: Render database (PostgreSQL 18) and the 19 uploaded files copied and checked by checksum; tested over
   HTTPS through the new tunnel with background loops off and test keys (signature, wrong-amount and duplicate
   webhooks behave correctly).
4. Switch: Render API suspended, final database export (21 users, 3 stores, 10 orders) restored, live keys and loops
   on, domain moved from the Worker to the tunnel, Paystack webhook and callback updated, `staging.` hostname removed.
5. Still open after the switch: one small real card payment and refund to confirm the live webhook end to end, and
   rolling the live Paystack secret key (it was shared in a chat).
