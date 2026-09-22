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

## API deployment blueprint

The repository includes `Dockerfile`, `.dockerignore`, and `render.yaml` for a Node/Docker API deployment with managed PostgreSQL. On Render:

1. Create a Blueprint from this repository using `render.yaml`.
2. Set the secret `AUTH_SECRET`, Paystack credentials, email/SMS provider values, and storage credentials in the Render dashboard.
3. Create and review the initial Prisma migration before using `db:migrate:deploy` in production.
4. Add the custom API domain `api.mydoorstep.com.co` to the web service.
5. Confirm `https://api.mydoorstep.com.co/api/health` and `/api/ready` before changing the Cloudflare frontend `VITE_API_BASE_URL` variable.
6. Redeploy the frontend with `VITE_API_BASE_URL=https://api.mydoorstep.com.co`.

## Required environment variables

Set all variables in the host environment, not in the frontend bundle.

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

The repository currently has no committed `prisma/migrations` history. Do not use `prisma db push` against production. Before the first production deployment:

1. Review the schema against a staging PostgreSQL database.
2. Create and review an initial migration with `prisma migrate dev` in a controlled development environment.
3. Commit the generated migration directory.
4. Run `npm.cmd run db:migrate:status` in staging.
5. Run `npm.cmd run db:migrate:deploy` during the production release.

Use `npm.cmd run db:push` only for disposable local development databases.

## Rollback

- Keep previous deployment artifact accessible
- Keep database migration backups ready
- Use environment-level rollback if configuration regression is detected
