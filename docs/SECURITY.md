# DOORSTEP Security Guide

## Implemented foundation

- Helmet security headers and CORS allow-listing
- Global and route-specific rate limits
- Zod request validation
- Scrypt password hashes and revocable opaque sessions
- Role and ownership checks for customer, restaurant, rider, and admin APIs
- HMAC Paystack webhook verification and payment reconciliation
- Private upload signature, size, and MIME validation
- Atomic delivery claims and conditional order/delivery transitions
- Audit entries for administrative application reviews
- `.env`, `.env.local`, `.env.production`, and `.env.TXT` are ignored by Git and are not tracked in this repository
- Server startup uses deployment environment variables in preference to values in a local `.env` file; a regression test covers this behavior

## Required before production

- Store production secrets in a managed secret store and verify/rotate any local credentials before using them outside development
- Add structured logging, alerting, dependency scanning, and security review
- Replace local private uploads with private object storage and malware scanning
- Add CSRF strategy if browser authentication moves to cookies
- Add lifecycle tests for password reset, payment replay, authorization, and uploads
- Review data retention for addresses, rider locations, documents, and support attachments
- Resolve the current Prisma transitive `deepmerge-ts@7.1.5` audit finding through a tested Prisma upgrade; do not use `npm audit fix --force` without reviewing the resulting Prisma version change

Never expose `PAYSTACK_SECRET_KEY`, database credentials, raw payment data, or private document URLs to the frontend.

## Audit scope and current evidence

The 2026-10-15 review was a first-pass repository and configuration audit, not a complete penetration test. Git tracking and ignore rules were checked without printing local environment values. A production frontend build and Prisma schema validation passed. After adding automatic Prisma Client generation, all 29 API tests passed. Provider credentials, deployment secrets, production access controls, and live integrations were not verified. See `PROJECT_AUDIT.md` and `BUILD_PROGRESS.md` for the current findings and test status.
