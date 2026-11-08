# DOORSTEP on ZimaOS (self-hosted)

How to move DOORSTEP from Render + the Cloudflare Worker to your own ZimaOS server with Docker Compose,
and how to run, back up and restore it afterwards. Files live in [deploy/zimaos/](../deploy/zimaos/).

## 1. What runs where

```
 visitors ──HTTPS──> Cloudflare DNS ──> Nginx Proxy Manager (on ZimaOS, has the certificates)
                                            │  mydoorstep.com.co, www, api.mydoorstep.com.co
                                            ▼
                                      web  (nginx, host port 8090)
                         ┌──────────────────┼────────────────────────┐
              React site + Android     /api/* and the live-delivery   api.mydoorstep.com.co
              app links + APK links    WebSocket                      (everything)
                                            ▼
                                      api  (Express + Prisma, port 4000, ONE instance)
                                            │  uploads: $DOORSTEP_DATA/private-uploads
                                            ▼
                                      db   (PostgreSQL 18, internal network only, no port)
                                      backup (nightly pg_dump + uploads archive)
```

- **Admin** is part of the website (`/admin/login`, `/admin/dashboard`); there is no separate admin service.
  The *DOORSTEP Admin* Android app and the customer app are full-screen wrappers of the website: they need
  `/.well-known/assetlinks.json` (served by the web container), nothing else.
- **Why the API goes through the web container**: on mydoorstep.com.co the site calls `/api` on its own domain
  (`src/config/apiBase.js`). The web nginx forwards it, and it also answers `api.mydoorstep.com.co`, so the visitor's
  address is worked out in one place (the API trusts exactly one proxy hop and rate-limits by that address).
- **One API container only**: dispatch (10 s), payout (60 s) and push (5 s) loops run inside it, and uploads are on a
  local disk. Two copies would pay out twice.
- Optional **Cloudflare Tunnel** (`--profile tunnel`) replaces router port forwarding when your internet line has
  no public IP (common on Nigerian ISPs: CGNAT).

## 2. One-time server preparation (you, on the ZimaOS dashboard)

1. **Turn on SSH**: ZimaOS dashboard → Settings → General → *Developer mode* → enable **SSH**. Note the user
   (usually your ZimaOS login) and the server's LAN IP (Settings → Network).
2. Open a terminal: from Windows, `ssh <user>@<server-ip>` (or the ZimaOS web terminal).
3. Check what you have (send this output to Claude if anything looks unusual):
   ```sh
   uname -m; docker version --format '{{.Server.Version}}'; docker compose version
   df -h /DATA; ls /DATA/AppData
   docker ps --format '{{.Names}}\t{{.Ports}}'      # shows Nginx Proxy Manager's ports
   ```
4. Get the code onto the server (pick one):
   - `cd /DATA/AppData && git clone -b deploy/zimaos-2026-11-07 https://github.com/allenclar6-tech/mydoorstep.git doorstep-src`
     (a private repo asks for a GitHub token as the password), **or**
   - copy the `DOORSTEP` folder into `/DATA/AppData/doorstep-src` with the ZimaOS Files app (skip `node_modules`).

## 3. Settings (.env)

```sh
cd /DATA/AppData/doorstep-src/deploy/zimaos
cp zimaos.env.example .env && chmod 600 .env
openssl rand -hex 24          # paste as POSTGRES_PASSWORD
vi .env                       # or: nano .env
```

Copy every `[COPY]` value from **Render → mydoorstep-api → Environment**. Most important:

| Value | Why it must be exact |
|---|---|
| `CARD_TOKEN_ENCRYPTION_KEY` | a different value makes every saved card unusable |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | **use the test keys first** (`sk_test_` / `pk_test_`) |
| `RESEND_API_KEY`, `VERIFICATION_FROM_EMAIL` | sign-up and sign-in codes by email |
| `TERMII_*` or `TWILIO_*`, `SMS_PROVIDER`, `WHATSAPP_*` | sign-in codes by SMS / WhatsApp |
| `MAPBOX_PUBLIC_TOKEN` (= `VITE_MAP_PUBLIC_TOKEN`) | maps; add `https://mydoorstep.com.co` to the token's URL list |
| `GOOGLE_CLIENT_ID`, `NINJA_SECRET_KEY` | Google sign-in, registry checks (optional) |

Not needed: `AUTH_SECRET` (the code never reads it; sessions are random tokens stored hashed in the database) and
`FIREBASE_CONFIGURATION` (push uses standard Web Push; its keys are stored in the database).

## 4. Build and start (no public traffic yet)

```sh
docker compose build                 # first build takes several minutes
docker compose up -d db
```

### 4a. Move the live data from Render (recommended)

Do this in a quiet hour; between the export and the DNS switch (step 6) new orders on Render would be lost, so
pause the stores first (Admin → stores) or announce a short maintenance window.

1. **Database**: Render → *mydoorstep-db* → *Info* → copy the **External Database URL**, then:
   ```sh
   bash scripts/import-database.sh --from-render --uploads /DATA/AppData/render-uploads.tar.gz
   ```
   It asks for the URL without showing it, dumps Render read-only, restores here, prints row counts and starts the
   API, whose start-up runs the guarded migrations. It refuses to run if the new database already has tables.
   (Or use a Render *Export* file: `--from-file /path/render-export.tar.gz`.)
2. **Uploads** (profile photos, store logos/menus, application documents) are on Render's disk at
   `/var/data/private-uploads`. Copy them with Render's SSH (service → *Connect* → *SSH* shows the address):
   ```sh
   ssh <service-id>@ssh.<region>.render.com "tar -czf - -C /var/data/private-uploads ." > /DATA/AppData/render-uploads.tar.gz
   ```
   Run this before step 1 so `--uploads` can unpack it. Without the copy, older images and documents show as missing.

### 4b. Or start with an empty database

```sh
docker compose run --rm --no-deps api npx prisma migrate deploy   # one time: creates all tables
docker compose up -d
```
(The normal start-up refuses an empty database on purpose; this one command is the deliberate way past it.)
Never run `npm run db:seed` or `prisma db push` here: the seed adds demo stores.

### 4c. Check it on the LAN

```sh
docker compose up -d
docker compose ps                     # db, api, web, backup: "healthy"/"running"
docker compose logs api | grep -E "migrations_ready|listening"
docker compose exec web nginx -t      # config check
curl -s http://localhost:8090/api/ready                      # {"status":"ready","database":"ok"}
curl -s -H 'Host: api.mydoorstep.com.co' http://localhost:8090/api/health
curl -sI http://localhost:8090/downloads/doorstep.apk | grep -i location
```
Then open `http://<server-ip>:8090` in a browser. (Sign-in from there is blocked by CORS on purpose; full tests run
after HTTPS is up.)

## 5. HTTPS with Nginx Proxy Manager

NPM is already installed (admin at `http://<server-ip>:81`). ZimaOS's own dashboard uses port 80, so first check
which host ports NPM's HTTP/HTTPS listen on (`docker ps`, step 2.3).

**Certificates**: use the **DNS challenge with Cloudflare** (SSL Certificates → Add → Let's Encrypt → *Use a DNS
Challenge* → Cloudflare, with an API token limited to *Zone → DNS → Edit* for mydoorstep.com.co). It works even
before the domain points at your server, and needs no port 80 at all.

Create two **Proxy Hosts** (Forward to the server's LAN IP, or `172.17.0.1`, port **8090**, scheme http):

| Domain names | Options | SSL tab |
|---|---|---|
| `mydoorstep.com.co`, `www.mydoorstep.com.co` | Websockets **on**, Block common exploits on | the certificate, Force SSL, HTTP/2, HSTS |
| `api.mydoorstep.com.co` | Websockets **on** | same certificate (or its own), Force SSL |

NPM sends `X-Forwarded-For`/`X-Forwarded-Proto` by default; leave *Custom locations* empty. In each host's
*Advanced* tab add `client_max_body_size 12m; proxy_read_timeout 3600s;` (uploads up to 5 MB, rider WebSockets).

**Router**: forward TCP 443 (and 80 if you want plain-http redirects) from the internet to NPM's host ports.
This is the only thing opened to the internet. PostgreSQL and the API are never forwarded.

**No public IP?** (Your router's WAN address differs from `curl -s https://ifconfig.me`, or starts with 100.64–100.127.)
Use the tunnel instead of port forwarding: Cloudflare Zero Trust → Networks → Tunnels → Create → copy the token into
`CLOUDFLARE_TUNNEL_TOKEN`, add public hostnames `mydoorstep.com.co`, `www.mydoorstep.com.co`, `api.mydoorstep.com.co`
→ service `http://web:80`, set `TRUST_CLOUDFLARE_IP=on`, then `docker compose --profile tunnel up -d`.

## 6. Switch the domain (cut-over)

Only when step 4c passes and `https://` works with a test hosts entry (see below).

1. Test first without touching DNS: on your PC, add `<server-public-ip> mydoorstep.com.co api.mydoorstep.com.co`
   to `C:\Windows\System32\drivers\etc\hosts`, browse the site, then remove the line.
2. **Cloudflare dashboard → Workers & Pages → mydoorstep-site-20260922 → Settings → Domains & Routes**: remove the
   `mydoorstep.com.co` custom domain/route (keep the Worker itself as the fallback).
3. **Cloudflare → DNS**: `A mydoorstep.com.co → <public IP>`, `CNAME www → mydoorstep.com.co`,
   `A api → <public IP>` (tunnel users: the tunnel creates these). Proxy status: *DNS only* with NPM, unless you also
   restrict NPM to Cloudflare's IP ranges and set `TRUST_CLOUDFLARE_IP=on`.
4. **Paystack dashboard → Settings → API Keys & Webhooks**: Webhook URL
   `https://api.mydoorstep.com.co/api/payments/webhook`, Callback URL `https://mydoorstep.com.co/payment/callback`.
5. **Google Cloud (OAuth client)** and **Mapbox token**: make sure `https://mydoorstep.com.co` is listed (already is
   if it worked before).
6. Watch `docker compose logs -f api` and run the tests in section 9.

**Rollback**: put the Worker's custom domain back (and the old DNS records). The Worker still forwards to Render,
so keep Render running until the new server has worked for at least a week.

## 7. Admin account

```sh
bash scripts/create-admin.sh
```
It asks for email, name and a password (hidden, at least 12 characters, never written to a file, history or log) and
runs the existing `server/createAdmin.js`. If that email already has an account, it becomes an admin and gets the new
password. Imported data already contains your existing admin accounts.

## 8. Backups and recovery

- The `backup` container makes a database dump and an uploads archive **every night at 02:00 (Lagos)** into
  `$DOORSTEP_BACKUPS` (default `$DOORSTEP_DATA/backups`), checks each dump is readable, writes `.sha256` files and
  keeps 14 days. Run one now: `docker compose exec backup sh /backup-loop.sh now`.
- **A backup on the same disk is not a backup.** Set `DOORSTEP_BACKUPS` to a second drive, and copy the folder off the
  server weekly (ZimaOS Backup app, or download it to your PC/Google Drive). Also keep `.env` in a password manager:
  without `CARD_TOKEN_ENCRYPTION_KEY` restored data can't use saved cards.
- **Restore** (replaces the current data; asks you to type RESTORE and saves the current state first):
  ```sh
  bash scripts/restore-backup.sh /DATA/AppData/doorstep/backups/db/doorstep-YYYYMMDD-HHMM.dump \
                                 /DATA/AppData/doorstep/backups/uploads/uploads-YYYYMMDD-HHMM.tar.gz
  ```
- **Test a restore once a month** on a copy: `DOORSTEP_DATA=/DATA/AppData/doorstep-restore-test`, a different
  `WEB_HOST_PORT` and `docker compose -p doorstep-test ...`, then delete that copy.
- Whole-server loss: new ZimaOS → steps 2–4 with the code and `.env` → `restore-backup.sh` with the newest files.

## 9. Production test checklist (Paystack TEST keys)

Do every row on a phone and a computer before switching to live keys.

| Area | Check |
|---|---|
| Customer | register (email code arrives), sign in, Google sign-in, profile photo upload |
| Shopping | browse stores, menu options, cart, checkout with test card `4084 0840 8408 4081`, order shows *paid* only after the server confirms |
| Webhook | Paystack dashboard → Webhooks → delivery log shows `200` for the test charge |
| Tracking | live order tracking updates; rider "Start location sharing" works |
| Restaurant | apply with documents, admin approves, partner sees and accepts orders, uploads logo/menu photos |
| Rider | apply with documents, admin approves, accepts a delivery, delivery code completes it |
| Admin | `/admin/login`, approvals, document archive opens files, money/payouts pages |
| Refunds | cancel a paid test order → refund recorded (Paystack test dashboard shows it) |
| Notifications | in-app bell, phone push after allowing notifications, SMS/WhatsApp code if configured |
| Android | both apps open full-screen (no address bar) = assetlinks OK; `/downloads/doorstep.apk` downloads |
| Restart | `docker compose restart api` → uploads and sign-ins survive; reboot the server → everything comes back |

Then switch `PAYSTACK_*` to the live keys, `docker compose up -d api`, and make one small real payment.

## 10. Updating later

```sh
cd /DATA/AppData/doorstep-src && git pull
cd deploy/zimaos && docker compose exec backup sh /backup-loop.sh now && docker compose up -d --build
```
The API applies new migrations itself at start (guarded by the baseline check). Never `prisma db push` here.
