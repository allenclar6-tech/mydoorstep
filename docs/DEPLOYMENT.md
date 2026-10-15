# DOORSTEP Deployment Guide

## Production requirements

- Managed PostgreSQL instance
- Private object storage for uploads
- HTTPS-enabled domain
- Environment-based secret management
- CI/CD pipeline with migration verification
- Monitoring and alerting
- Regular database backups

## Recommended deployment targets

- Frontend: Vercel or Netlify
- API: Render, Railway, DigitalOcean App Platform, Azure App Service, or a managed Node host
- Database: Neon, Supabase Postgres, Azure Database for PostgreSQL, or another managed PostgreSQL service
- Storage: S3-compatible object storage or Cloudinary for public assets and private document storage

## Current domain plan

- Public website: `https://mydoorstep.com.co`
- Admin: `https://mydoorstep.com.co/admin/login`
- API: `https://api.mydoorstep.com.co`
- Cloudflare Pages build command: `npm run build`
- Cloudflare Pages output directory: `dist`
- SPA fallback: `wrangler.jsonc` with `assets.not_found_handling="single-page-application"`
- Cloudflare redeploy command: `npm.cmd run cloudflare:deploy`

Cloudflare Pages hosts the Vite frontend. The Express/Prisma API must run on a Node-capable service with managed PostgreSQL; it should not be deployed as static Pages output.

If the Cloudflare Worker asset bundle is behind the Render frontend deployment, the Worker forwards public web requests to `https://mydoorstep-web.onrender.com` while continuing to proxy `/api/*` requests to the API service. This keeps the custom domain current until the next Wrangler asset deployment.

## API deployment blueprint

The repository includes `Dockerfile`, `.dockerignore`, and `render.yaml` for a Node/Docker API deployment with managed PostgreSQL. On Render:

1. Create a Blueprint from this repository using `render.yaml`.
2. Set the secret `AUTH_SECRET`, Paystack credentials, email/SMS provider values, and storage credentials in the Render dashboard.
3. Review the tracked baseline and follow-up Prisma migrations against staging before using `db:migrate:deploy` in production.
4. Add the custom API domain `api.mydoorstep.com.co` to the web service.
5. Confirm `https://api.mydoorstep.com.co/api/health` and `/api/ready` before changing the Cloudflare frontend `VITE_API_BASE_URL` variable.
6. Redeploy the frontend with `VITE_API_BASE_URL=https://api.mydoorstep.com.co`.

## Required environment variables

Set server secrets in the host's secret manager, not in the frontend bundle. The API loads `.env` for local development without overriding variables injected by the host. Never put private credentials in `VITE_*` variables; Vite embeds those values into public assets.

Required:
- DATABASE_URL
- AUTH_SECRET
- PAYMENT_PROVIDER
- PAYMENT_CALLBACK_URL
- PAYSTACK_PUBLIC_KEY
- PAYSTACK_SECRET_KEY
- FLUTTERWAVE_PUBLIC_KEY
- FLUTTERWAVE_SECRET_KEY
- GOOGLE_MAPS_API_KEY
- MAPBOX_TOKEN
- CLOUDINARY_URL
- FIREBASE_CONFIGURATION
- EMAIL_PROVIDER
- SMS_PROVIDER
- NEXT_PUBLIC_APP_URL

The frontend also uses the public configuration variables `VITE_API_BASE_URL`, `VITE_MAP_PROVIDER`, `VITE_MAP_PUBLIC_TOKEN`, and `VITE_PAYMENTS_PROVIDER` where applicable. The API accepts `PAYMENTS_PROVIDER` as a legacy alias, but new deployments should set `PAYMENT_PROVIDER`.

## Release checklist

1. Validate Prisma schema
2. Run database migration in staging
3. Run API tests and smoke tests
4. Confirm payment provider and webhook signing
5. Confirm uploads are private and validated
6. Confirm admin approvals work in a real environment
7. Enable HTTPS and domain protection
8. Back up database and confirm rollback process

## Migration workflow

The repository contains seven tracked Prisma migrations: the existing-schema baseline and six subsequent changes. A read-only check of the configured local database at `localhost:5432` found all seven pending; the command exited nonzero and did not change the database. Do not use `prisma db push` against production. The staging recovery copy was compared against the baseline, migrated, and passed API readiness before considering a production release.

1. Confirm a current Render logical export is available and retain the isolated point-in-time recovery copy until production health is verified.
2. Compare the restored schema with `prisma/baseline.prisma`. The initial diff found three absent restaurant objects; the baseline was corrected and an additive migration now creates them.
3. The staging database had no migration history. The guarded migration runner verified the corrected baseline, applied the baseline record and all follow-up migrations, then passed `/api/ready`.
4. Re-run tests/build/schema checks after any release change. Never run `prisma db push` against production.
5. Deploy to `main` only after confirming Render's auto-deploy branch remains `main`; monitor the startup migration logs and `/api/ready` until healthy.

Use `npm.cmd run db:push` only for disposable local development databases.

## Production release status (2026-10-15)

- Promoted `9c625ee` to `main`; Render auto-deployed the API successfully. Documentation-only commits `a38024e` and `423f6c5` also deployed successfully as `dep-db8fmgk9v7es73dgqg00` and `dep-db8g123bc2fs739ounc0`; both were marked live.
- The latest runtime release remains `9c625ee`; the guarded migration runner completed successfully on that application release (`migrations_ready`). The later commits only updated documentation.
- Production checks returned `{"service":"doorstep-api","status":"ok","environment":"production"}` from `/api/health` and `{"service":"doorstep-api","status":"ready","database":"ok"}` from `/api/ready`. The same-origin `/api/ready` route through `https://mydoorstep.com.co` also returned ready.
- The public storefront loads at `https://mydoorstep.com.co`; Cloudflare Worker `mydoorstep-site-20260922` forwards `/api/*` to the Render API.
- Staging migration validation succeeded before release. After production health and the fresh export were verified, the temporary staging database containing production-derived data was deleted to reduce retained data and avoid accidental exposure.
- A fresh production logical export created at `2026-10-15T16:27Z` was downloaded to the local Downloads folder and verified as a readable gzip-compressed tar archive. SHA-256: `B1A6488AF9AE989AC8B1972EC956628950C8C0758A08FFF00437A622B45A1C46`. This backup contains production data: keep it private, out of source control, and in a secure location. Render retains export files for at least seven days; keep an independent copy beyond that window.
- The 33 API tests pass. The Prisma 6.19.3 dependency tree is pinned to patched `deepmerge-ts` 8.0.0 through the root npm override; both `npm audit` and `npm audit --omit=dev` report zero vulnerabilities. Schema validation and the production build pass with Prisma unchanged.
- The separate `api.mydoorstep.com.co` hostname is not required for current API traffic, which uses the same-origin Cloudflare proxy. Treat custom API DNS as follow-up configuration.
- The API `Dockerfile` runs the guarded migration runner before starting the service. Keep using the verified staging/backup process for future schema changes; never use `prisma db push` against production.

## Rollback

- Keep previous deployment artifact accessible
- Keep database migration backups ready
- Use environment-level rollback if configuration regression is detected
