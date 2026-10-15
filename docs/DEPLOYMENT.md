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

The repository contains six tracked Prisma migrations: the existing-schema baseline and five subsequent changes. A read-only check of the configured local database at `localhost:5432` found all six pending; the command exited nonzero and did not change the database. The live Render database is a separate production database. Do not use `prisma db push` against production or apply migrations until the migration history and a restorable backup are verified. Before deploying:

1. Back up the staging database and verify the restore procedure. For production, confirm a current Render logical export is complete and downloadable before release.
2. Review the baseline migration against the actual staging schema; do not mark an existing production database as baselined without verifying its schema and migration history.
3. Run `npm.cmd run db:migrate:status` against staging and resolve any drift without deleting real data.
4. Determine whether staging already contains the baseline schema or production data. Have the database owner approve a non-destructive baseline/reconciliation plan before applying or baselining migrations.
5. Apply pending migrations in staging and run the API regression suite.
6. Run `npm.cmd run db:migrate:deploy` during production release only after the staging and backup checks have passed.

Use `npm.cmd run db:push` only for disposable local development databases.

## Deployment blockers found during the 2026-10-15 release check

- Cloudflare serves the storefront through `mydoorstep-site-20260922`; its Worker forwards `/api/*` to the Render API at `https://mydoorstep-api.onrender.com`.
- The Render production project contains `mydoorstep-api` and `mydoorstep-db`. The API's latest deploy, from commit `d39a6a8`, failed during startup; the prior API remains healthy.
- The failed deploy log identifies the migration guard's `to_regclass(...)` result as an unsupported `regclass` type for Prisma `$queryRaw`. `server/migrate.js` now casts the result to `text`; tests and the frontend build pass locally.
- The production Recovery page now lists a logical export as `.dir.tar.gz`; it has not yet been downloaded or independently restore-tested.
- A point-in-time recovery copy named `mydoorstep-db-staging` is being created from production. Render still reports `Recovery In Progress`, so credentials are unavailable and no staging database command can run yet.
- Production and staging migration history have not been inspected. Do not deploy the migration runner until the staging copy is available, the schema baseline is verified, pending migrations succeed on staging, and the API is smoke-tested.
- Wrangler is not installed in the local project. Dashboard access is available, but no CLI credentials are configured in the local environment.
- No GitHub Actions deployment workflow is configured.
- `render.yaml` now points to a valid `Dockerfile.web` in the repository; the Render web service definition is ready for a Blueprint deployment once credentials and staging migration checks are completed.
- The existing API `Dockerfile` runs `server/migrate.js` before starting the API. That script checks the baseline schema and then applies pending migrations, so verify a staging backup and migration state before releasing the API. The repository also includes a valid frontend `Dockerfile.web` for the Render web service.
- The existing production API remains ready at `/api/ready`; the failed latest deployment has not been retried. No migration, production deploy, DNS change, or production service configuration change has been performed.

## Rollback

- Keep previous deployment artifact accessible
- Keep database migration backups ready
- Use environment-level rollback if configuration regression is detected
